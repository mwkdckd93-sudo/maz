const jwt = require('jsonwebtoken');

// SECURITY: JWT_SECRET must be set in environment variables
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.warn('⚠️ WARNING: JWT_SECRET not set! Using fallback for development only.');
}
const SECRET = JWT_SECRET || 'dev_only_secret_change_in_production';

// Verify JWT Token Middleware
const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      message: 'Access token required',
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired token',
    });
  }
};

// Alias for verifyToken
const authenticateToken = verifyToken;

// Require Admin role - SECURITY: Must verify from database
const requireAdmin = async (req, res, next) => {
  try {
    // First check JWT claims
    if (!req.user || !req.user.userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }
    
    // SECURITY: Always verify admin role from database, never trust JWT alone
    const db = require('../config/database');
    const [users] = await db.execute(
      'SELECT role FROM users WHERE id = ? AND is_active = TRUE',
      [req.user.userId]
    );
    
    if (users.length === 0) {
      return res.status(401).json({ success: false, message: 'User not found or inactive' });
    }
    
    if (users[0].role !== 'admin') {
      console.warn(`⚠️ SECURITY: Non-admin user ${req.user.userId} attempted admin access`);
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }
    
    next();
  } catch (error) {
    console.error('Admin check error:', error);
    return res.status(500).json({ success: false, message: 'Authorization failed' });
  }
};

// Optional auth - doesn't fail if no token
const optionalAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, SECRET);
      req.user = decoded;
    } catch (error) {
      // Token invalid, but continue without user
    }
  }
  next();
};

// Generate JWT Token
const generateToken = (userId, phone, options = {}) => {
  return jwt.sign(
    { userId, phone, ...options },
    SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
};

module.exports = {
  verifyToken,
  authenticateToken,
  requireAdmin,
  optionalAuth,
  generateToken,
};
