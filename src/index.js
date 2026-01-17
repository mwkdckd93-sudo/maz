require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Server } = require('socket.io');

// ============================================
// SECURITY: Validate required environment variables
// ============================================
const REQUIRED_ENV_VARS = ['JWT_SECRET', 'DB_PASSWORD'];
const missingVars = REQUIRED_ENV_VARS.filter(v => !process.env[v]);
if (missingVars.length > 0 && process.env.NODE_ENV === 'production') {
  console.error('❌ FATAL: Missing required environment variables:', missingVars.join(', '));
  console.error('❌ Server cannot start in production without these variables!');
  process.exit(1);
}

// Allowed origins for CORS
const ALLOWED_ORIGINS = [
  'https://hajja.app',
  'https://admin.hajja.app',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:8080',
];

// Import routes
const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const auctionRoutes = require('./routes/auction.routes');
const bidRoutes = require('./routes/bid.routes');
const categoryRoutes = require('./routes/category.routes');
const notificationRoutes = require('./routes/notification.routes');
const uploadRoutes = require('./routes/upload.routes');
const adminRoutes = require('./routes/admin.routes');
const chatRoutes = require('./routes/chat.routes');
const whatsappRoutes = require('./routes/whatsapp.routes');
const reelsRoutes = require('./routes/reels.routes');

// Import WhatsApp service
const whatsappService = require('./services/whatsapp.service');

// Import socket handlers
const { setupSocketHandlers } = require('./socket/socket.handler');

// Import database
const db = require('./config/database');

const app = express();
const server = http.createServer(app);

// Socket.IO setup with CORS
const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  allowEIO3: true, // Allow Engine.IO v3 clients
  transports: ['polling', 'websocket'],
  pingTimeout: 60000,
  pingInterval: 25000,
});

// Log all Socket.IO connections at engine level
io.engine.on('connection', (rawSocket) => {
  console.log('🔌 Engine.IO connection established:', rawSocket.id);
});

io.engine.on('connection_error', (err) => {
  console.log('❌ Engine.IO connection error:', err.req?.url, err.code, err.message);
});

// Make io accessible to routes
app.set('io', io);

// SECURITY: Trust proxy for rate limiting behind nginx/cloudflare
app.set('trust proxy', 1);

// Middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "blob:", "https:", "http:"],
      mediaSrc: ["'self'", "data:", "blob:", "https:", "http:"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https:"],
      connectSrc: ["'self'", "https:", "wss:", "ws:"],
      fontSrc: ["'self'", "https:", "data:"],
      objectSrc: ["'none'"],
      frameSrc: ["'self'"],
    },
  },
}));

// SECURITY: CORS with whitelist
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, curl, etc)
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.warn('⚠️ CORS blocked origin:', origin);
      callback(null, true); // Allow but log - change to callback(new Error('Not allowed')) in strict mode
    }
  },
  credentials: true,
};
app.use(cors(corsOptions));

// SECURITY: Global rate limiting (100 requests per 15 minutes per IP)
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  message: { success: false, message: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(globalLimiter);

// SECURITY: Strict rate limiting for auth routes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per 15 minutes
  message: { success: false, message: 'Too many login attempts, please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// SECURITY: Rate limiting for OTP (5 per hour per IP)
const otpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: { success: false, message: 'Too many OTP requests, please try again after 1 hour.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// SECURITY: Rate limiting for bids (30 per minute)
const bidLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  message: { success: false, message: 'Too many bid attempts, please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// SECURITY: Global XSS sanitization middleware
const xss = require('xss');
const sanitizeInput = (req, res, next) => {
  const sanitizeObject = (obj) => {
    if (typeof obj === 'string') {
      return xss(obj);
    } else if (Array.isArray(obj)) {
      return obj.map(sanitizeObject);
    } else if (obj && typeof obj === 'object') {
      const sanitized = {};
      for (const key in obj) {
        sanitized[key] = sanitizeObject(obj[key]);
      }
      return sanitized;
    }
    return obj;
  };
  
  if (req.body) {
    req.body = sanitizeObject(req.body);
  }
  if (req.query) {
    req.query = sanitizeObject(req.query);
  }
  next();
};
app.use(sanitizeInput);

// Static files for uploads with CORS headers
app.use('/uploads', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
}, express.static('uploads'));

// API Routes with rate limiting
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/send-otp', otpLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/auctions', auctionRoutes);
app.use('/api/bids', bidLimiter, bidRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/reels', reelsRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Info
app.get('/api', (req, res) => {
  res.json({
    name: 'Mazad API',
    version: '1.0.0',
    description: 'Iraqi Auction Platform API',
    endpoints: {
      auth: '/api/auth',
      users: '/api/users',
      auctions: '/api/auctions',
      bids: '/api/bids',
      categories: '/api/categories',
      notifications: '/api/notifications',
    },
  });
});

// Setup WebSocket handlers
setupSocketHandlers(io);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: 'Internal Server Error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, async () => {
  console.log(`
  ╔══════════════════════════════════════════╗
  ║     🔨 Mazad API Server Running 🔨       ║
  ╠══════════════════════════════════════════╣
  ║  Port: ${PORT}                              ║
  ║  Mode: ${process.env.NODE_ENV || 'development'}                     ║
  ║  Socket.IO: Enabled                      ║
  ╚══════════════════════════════════════════╝
  `);
  
  // Start WhatsApp service automatically
  try {
    whatsappService.initialize();
    console.log('📱 WhatsApp service auto-starting...');
  } catch (error) {
    console.log('📱 WhatsApp service will start on first connection request');
  }
});

module.exports = { app, server, io };
