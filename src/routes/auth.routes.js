const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const { generateToken } = require('../middleware/auth.middleware');
const whatsappService = require('../services/whatsapp.service');

const router = express.Router();

// =====================================================
// CHECK PHONE & SEND OTP
// POST /api/auth/send-otp
// Returns whether user exists or needs registration
// =====================================================
router.post('/send-otp', [
  body('phone').matches(/^07[0-9]{9}$/).withMessage('Invalid Iraqi phone number'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { phone } = req.body;
    
    // Check if user exists
    const [users] = await db.execute(
      'SELECT id, full_name FROM users WHERE phone = ?',
      [phone]
    );

    const userExists = users.length > 0;
    
    // Try to send OTP via WhatsApp
    let otpSent = false;
    let devOtp = null;
    
    const waStatus = whatsappService.getStatus();
    if (waStatus.isConnected) {
      try {
        const result = await whatsappService.sendOTP(phone);
        otpSent = result.success;
        console.log(`📱 WhatsApp OTP sent to ${phone}`);
      } catch (waError) {
        console.error('WhatsApp OTP failed:', waError.message);
      }
    }
    
    // Fallback to random OTP for development (NOT fixed!)
    if (!otpSent) {
      // SECURITY: Generate random OTP, never use fixed value
      if (process.env.NODE_ENV === 'production') {
        return res.status(503).json({
          success: false,
          message: 'WhatsApp service unavailable. Please try again later.',
        });
      }
      // Development only: Generate random 6-digit OTP
      devOtp = Math.floor(100000 + Math.random() * 900000).toString();
      whatsappService.otpStore.set(phone, {
        code: devOtp,
        expiresAt: Date.now() + 5 * 60 * 1000
      });
      console.log(`📱 [DEV] Random OTP for ${phone}: ${devOtp}`);
    }

    res.json({
      success: true,
      message: userExists ? 'أدخل الرمز للدخول' : 'أدخل الرمز لإكمال التسجيل',
      userExists: userExists,
      userName: userExists ? users[0].full_name : null,
      otpMethod: otpSent ? 'whatsapp' : 'fallback',
      dev_otp: devOtp, // Only included when using fallback
    });
  } catch (error) {
    console.error('Send OTP Error:', error);
    res.status(500).json({ success: false, message: 'Failed to send OTP' });
  }
});

// =====================================================
// VERIFY OTP (Uses WhatsApp service or fallback)
// POST /api/auth/verify-otp
// =====================================================
router.post('/verify-otp', [
  body('phone').matches(/^07[0-9]{9}$/).withMessage('Invalid phone number'),
  body('otp').isLength({ min: 4, max: 6 }).withMessage('OTP must be 4-6 digits'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { phone, otp } = req.body;

    console.log(`🔐 Verify OTP - Phone: ${phone}, OTP: ${otp}, Type: ${typeof otp}`);

    // Verify using WhatsApp service (handles both WA OTPs and fallback)
    const verification = whatsappService.verifyOTP(phone, String(otp));
    
    if (!verification.valid) {
      console.log(`❌ OTP verification failed: ${verification.message}`);
      return res.status(400).json({
        success: false,
        message: verification.message,
      });
    }

    console.log(`✅ OTP verified for ${phone}`);

    // Check if user exists
    const [users] = await db.execute(
      'SELECT * FROM users WHERE phone = ?',
      [phone]
    );

    if (users.length === 0) {
      // New user - needs registration
      return res.json({
        success: true,
        isNewUser: true,
        message: 'OTP verified. Please complete registration.',
        tempToken: generateToken('temp_' + phone, phone),
      });
    }

    // Existing user - login
    const user = users[0];
    const token = generateToken(user.id, user.phone);

    res.json({
      success: true,
      isNewUser: false,
      token,
      user: {
        id: user.id,
        fullName: user.full_name,
        phone: user.phone,
        email: user.email,
        avatarUrl: user.avatar_url,
        walletBalance: parseFloat(user.wallet_balance || 0),
        isVerified: user.is_verified === 1,
        createdAt: user.created_at,
      },
    });
  } catch (error) {
    console.error('Verify OTP Error:', error);
    res.status(500).json({ success: false, message: 'Verification failed' });
  }
});

// =====================================================
// REGISTER (With password)
// POST /api/auth/register
// =====================================================
router.post('/register', [
  body('phone').matches(/^07[0-9]{9}$/).withMessage('Invalid phone number'),
  body('fullName').isLength({ min: 3 }).withMessage('Name must be at least 3 characters'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { phone, fullName, password, address } = req.body;
    const city = address?.city || address?.province;
    const area = address?.area || address?.landmark;

    // Check if user already exists
    const [existing] = await db.execute(
      'SELECT id FROM users WHERE phone = ?',
      [phone]
    );

    if (existing.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'User already exists with this phone or email',
      });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user
    const userId = uuidv4();
    await db.execute(
      'INSERT INTO users (id, full_name, phone, password_hash) VALUES (?, ?, ?, ?)',
      [userId, fullName, phone, passwordHash]
    );

    // Create address if provided
    if (city) {
      await db.execute(
        'INSERT INTO addresses (id, user_id, city, area, is_primary) VALUES (?, ?, ?, ?, TRUE)',
        [uuidv4(), userId, city, area || null]
      );
    }

    // Generate token
    const token = generateToken(userId, phone);

    res.status(201).json({
      success: true,
      message: 'Registration successful',
      token,
      user: {
        id: userId,
        fullName,
        phone,
        email: null,
        walletBalance: 0,
        isVerified: false,
        createdAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Register Error:', error);
    res.status(500).json({ success: false, message: 'Registration failed' });
  }
});

// =====================================================
// LOGIN WITH EMAIL
// POST /api/auth/login
// =====================================================
router.post('/login', [
  body('email').isEmail().withMessage('Invalid email'),
  body('password').notEmpty().withMessage('Password required'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { email, password } = req.body;

    // Find user
    const [users] = await db.execute(
      'SELECT * FROM users WHERE email = ? AND is_active = TRUE',
      [email]
    );

    if (users.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    const user = users[0];

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    // Generate token
    const token = generateToken(user.id, user.phone);

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        fullName: user.full_name,
        phone: user.phone,
        email: user.email,
        avatarUrl: user.avatar_url,
        walletBalance: user.wallet_balance,
        isVerified: user.is_verified,
        rating: user.rating,
        totalAuctions: user.total_auctions,
        totalBids: user.total_bids,
        role: user.role || 'user',
      },
    });
  } catch (error) {
    console.error('Login Error:', error);
    res.status(500).json({ success: false, message: 'Login failed' });
  }
});

module.exports = router;
