const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { queryOne, query, generateUUID } = require('../db/mysql');
const { setUserSession, deleteUserSession } = require('../db/redis');
const {
  authenticate,
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} = require('../middleware/auth');
const { otpLimiter, loginLimiter } = require('../middleware/rateLimiter');
const { asyncHandler } = require('../middleware/errorHandler');
const config = require('../config');
const Joi = require('joi');

// =============================================
// VALIDATION SCHEMAS
// =============================================

const phoneSchema = Joi.string()
  .pattern(/^\+964[0-9]{10}$/)
  .required()
  .messages({
    'string.pattern.base': 'رقم الهاتف يجب أن يبدأ بـ +964 ويتكون من 13 رقم',
  });

const registerSchema = Joi.object({
  phone: phoneSchema,
  fullName: Joi.string().min(3).max(100).required(),
  password: Joi.string().min(6).required(),
  email: Joi.string().email().optional(),
  province: Joi.string().valid(...config.iraqiProvinces).optional(),
});

const loginSchema = Joi.object({
  phone: phoneSchema,
  password: Joi.string().required(),
});

const adminLoginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required(),
});

const otpVerifySchema = Joi.object({
  phone: phoneSchema,
  otp: Joi.string().length(6).required(),
});

// =============================================
// ROUTES
// =============================================

/**
 * POST /api/v1/auth/register
 * Register a new user
 */
router.post('/register', asyncHandler(async (req, res) => {
  const { error, value } = registerSchema.validate(req.body);
  if (error) {
    return res.status(400).json({
      success: false,
      code: 'VALIDATION_ERROR',
      message: error.details[0].message,
    });
  }

  const { phone, fullName, password, email, province } = value;

  // Check if phone already exists
  const existing = await queryOne('SELECT id FROM users WHERE phone = ?', [phone]);
  if (existing) {
    return res.status(409).json({
      success: false,
      code: 'PHONE_EXISTS',
      message: 'رقم الهاتف مسجل مسبقاً',
    });
  }

  // Hash password
  const passwordHash = await bcrypt.hash(password, 12);

  // Create user with UUID - Active directly without verification
  const userId = generateUUID();
  await query(
    `INSERT INTO users (id, phone, full_name, password_hash, email, province, status, phone_verified)
     VALUES (?, ?, ?, ?, ?, ?, 'active', TRUE)`,
    [userId, phone, fullName, passwordHash, email, province]
  );
  
  // Fetch the created user
  const user = await queryOne('SELECT id, phone, full_name, status, is_admin, wallet_balance FROM users WHERE id = ?', [userId]);

  // Generate tokens and log user in directly
  const accessToken = generateAccessToken(user.id);
  const refreshToken = generateRefreshToken(user.id);

  // Store refresh token
  const tokenHash = await bcrypt.hash(refreshToken, 10);
  const tokenId = generateUUID();
  await query(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at)
     VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY))`,
    [tokenId, user.id, tokenHash]
  );

  // Store session
  await setUserSession(user.id, {
    userId: user.id,
    phone: user.phone,
    lastActive: new Date().toISOString(),
  });

  console.log(`✅ New user registered: ${phone}`);

  res.status(201).json({
    success: true,
    message: 'تم إنشاء الحساب بنجاح!',
    data: {
      user: {
        id: user.id,
        phone: user.phone,
        fullName: user.full_name,
        isAdmin: user.is_admin,
        walletBalance: user.wallet_balance,
      },
      accessToken,
      refreshToken,
    },
  });
}));

/**
 * POST /api/v1/auth/send-otp
 * Send OTP for login/verification
 */
router.post('/send-otp', otpLimiter, asyncHandler(async (req, res) => {
  const { error, value } = Joi.object({ phone: phoneSchema }).validate(req.body);
  if (error) {
    return res.status(400).json({
      success: false,
      code: 'VALIDATION_ERROR',
      message: error.details[0].message,
    });
  }

  const { phone } = value;

  // Check if user exists
  const user = await queryOne('SELECT id, status FROM users WHERE phone = ?', [phone]);
  if (!user) {
    return res.status(404).json({
      success: false,
      code: 'USER_NOT_FOUND',
      message: 'المستخدم غير موجود',
    });
  }

  // Generate OTP
  const otp = generateOTP();
  const expiresAt = new Date(Date.now() + config.otp.expiryMinutes * 60 * 1000);

  // Invalidate previous OTPs
  await query(
    `UPDATE otp_verifications SET is_used = TRUE WHERE phone = ? AND is_used = FALSE`,
    [phone]
  );

  // Create new OTP
  await query(
    `INSERT INTO otp_verifications (id, phone, otp_code, purpose, expires_at)
     VALUES (?, ?, ?, 'login', ?)`,
    [generateUUID(), phone, otp, expiresAt]
  );

  // TODO: Send OTP via SMS
  console.log(`📱 OTP for ${phone}: ${otp}`);

  res.json({
    success: true,
    message: 'تم إرسال رمز التحقق',
    data: {
      expiresIn: config.otp.expiryMinutes * 60,
    },
  });
}));

/**
 * POST /api/v1/auth/verify-otp
 * Verify OTP and authenticate
 */
router.post('/verify-otp', asyncHandler(async (req, res) => {
  const { error, value } = otpVerifySchema.validate(req.body);
  if (error) {
    return res.status(400).json({
      success: false,
      code: 'VALIDATION_ERROR',
      message: error.details[0].message,
    });
  }

  const { phone, otp } = value;

  // Find valid OTP
  const otpRecord = await queryOne(
    `SELECT * FROM otp_verifications 
     WHERE phone = ? AND otp_code = ? AND is_used = FALSE AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [phone, otp]
  );

  if (!otpRecord) {
    // Increment attempts
    await query(
      `UPDATE otp_verifications SET attempts = attempts + 1 
       WHERE phone = ? AND is_used = FALSE`,
      [phone]
    );

    return res.status(400).json({
      success: false,
      code: 'INVALID_OTP',
      message: 'رمز التحقق غير صحيح أو منتهي',
    });
  }

  // Check max attempts
  if (otpRecord.attempts >= config.otp.maxAttempts) {
    return res.status(400).json({
      success: false,
      code: 'MAX_ATTEMPTS',
      message: 'تم تجاوز الحد الأقصى للمحاولات',
    });
  }

  // Mark OTP as used
  await query('UPDATE otp_verifications SET is_used = TRUE WHERE id = ?', [otpRecord.id]);

  // Update user phone_verified status
  await query(
    `UPDATE users SET phone_verified = TRUE, status = 'active', last_login_at = NOW()
     WHERE phone = ?`,
    [phone]
  );
  
  // Fetch the updated user
  const user = await queryOne(
    `SELECT id, phone, full_name, status, is_admin, wallet_balance FROM users WHERE phone = ?`,
    [phone]
  );

  // Generate tokens
  const accessToken = generateAccessToken(user.id);
  const refreshToken = generateRefreshToken(user.id);

  // Store refresh token hash
  const tokenHash = await bcrypt.hash(refreshToken, 10);
  const tokenId = generateUUID();
  await query(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at)
     VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY))`,
    [tokenId, user.id, tokenHash]
  );

  // Store session in Redis
  await setUserSession(user.id, {
    userId: user.id,
    phone: user.phone,
    lastActive: new Date().toISOString(),
  });

  res.json({
    success: true,
    message: 'تم تسجيل الدخول بنجاح',
    data: {
      user: {
        id: user.id,
        phone: user.phone,
        fullName: user.full_name,
        isAdmin: user.is_admin,
        walletBalance: user.wallet_balance,
      },
      accessToken,
      refreshToken,
    },
  });
}));

/**
 * POST /api/v1/auth/login
 * Login with phone and password
 */
router.post('/login', loginLimiter, asyncHandler(async (req, res) => {
  const { error, value } = loginSchema.validate(req.body);
  if (error) {
    return res.status(400).json({
      success: false,
      code: 'VALIDATION_ERROR',
      message: error.details[0].message,
    });
  }

  const { phone, password } = value;

  // Find user
  const user = await queryOne(
    `SELECT id, phone, full_name, password_hash, status, is_admin, wallet_balance, phone_verified
     FROM users WHERE phone = ?`,
    [phone]
  );

  if (!user) {
    return res.status(401).json({
      success: false,
      code: 'INVALID_CREDENTIALS',
      message: 'رقم الهاتف أو كلمة المرور غير صحيحة',
    });
  }

  // Verify password
  const validPassword = await bcrypt.compare(password, user.password_hash);
  if (!validPassword) {
    return res.status(401).json({
      success: false,
      code: 'INVALID_CREDENTIALS',
      message: 'رقم الهاتف أو كلمة المرور غير صحيحة',
    });
  }

  // Check account status
  if (user.status === 'banned') {
    return res.status(403).json({
      success: false,
      code: 'ACCOUNT_BANNED',
      message: 'تم حظر حسابك',
    });
  }

  // Skip phone verification check for development
  // if (!user.phone_verified) {
  //   return res.status(403).json({
  //     success: false,
  //     code: 'PHONE_NOT_VERIFIED',
  //     message: 'يجب التحقق من رقم الهاتف',
  //     requiresVerification: true,
  //   });
  // }

  // Update last login
  await query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);

  // Generate tokens
  const accessToken = generateAccessToken(user.id);
  const refreshToken = generateRefreshToken(user.id);

  // Store refresh token
  const tokenHash = await bcrypt.hash(refreshToken, 10);
  const tokenId = generateUUID();
  await query(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at)
     VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY))`,
    [tokenId, user.id, tokenHash]
  );

  // Store session
  await setUserSession(user.id, {
    userId: user.id,
    phone: user.phone,
    lastActive: new Date().toISOString(),
  });

  res.json({
    success: true,
    message: 'تم تسجيل الدخول بنجاح',
    data: {
      user: {
        id: user.id,
        phone: user.phone,
        fullName: user.full_name,
        isAdmin: user.is_admin,
        walletBalance: user.wallet_balance,
      },
      accessToken,
      refreshToken,
    },
  });
}));

/**
 * POST /api/v1/auth/admin/login
 * Admin login with email and password
 */
router.post('/admin/login', loginLimiter, asyncHandler(async (req, res) => {
  const { error, value } = adminLoginSchema.validate(req.body);
  if (error) {
    return res.status(400).json({
      success: false,
      code: 'VALIDATION_ERROR',
      message: error.details[0].message,
    });
  }

  const { email, password } = value;

  // Find admin user by email
  const user = await queryOne(
    `SELECT id, phone, email, full_name, password_hash, status, is_admin, wallet_balance, role
     FROM users WHERE email = ?`,
    [email]
  );

  if (!user) {
    return res.status(401).json({
      success: false,
      code: 'INVALID_CREDENTIALS',
      message: 'البريد الإلكتروني أو كلمة المرور غير صحيحة',
    });
  }

  // Check if user is admin
  if (user.role !== 'admin' && !user.is_admin) {
    return res.status(403).json({
      success: false,
      code: 'NOT_ADMIN',
      message: 'غير مصرح لك بالدخول',
    });
  }

  // Verify password
  const validPassword = await bcrypt.compare(password, user.password_hash);
  if (!validPassword) {
    return res.status(401).json({
      success: false,
      code: 'INVALID_CREDENTIALS',
      message: 'البريد الإلكتروني أو كلمة المرور غير صحيحة',
    });
  }

  // Check account status
  if (user.status === 'banned') {
    return res.status(403).json({
      success: false,
      code: 'ACCOUNT_BANNED',
      message: 'تم حظر حسابك',
    });
  }

  // Update last login
  await query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);

  // Generate tokens
  const accessToken = generateAccessToken(user.id);
  const refreshToken = generateRefreshToken(user.id);

  // Store refresh token
  const tokenHash = await bcrypt.hash(refreshToken, 10);
  const tokenId = generateUUID();
  await query(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at)
     VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY))`,
    [tokenId, user.id, tokenHash]
  );

  // Store session
  await setUserSession(user.id, {
    userId: user.id,
    email: user.email,
    lastActive: new Date().toISOString(),
  });

  res.json({
    success: true,
    message: 'تم تسجيل الدخول بنجاح',
    data: {
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        fullName: user.full_name,
        isAdmin: true,
        role: user.role,
      },
      accessToken,
      refreshToken,
    },
  });
}));

/**
 * POST /api/v1/auth/refresh
 * Refresh access token
 */
router.post('/refresh', asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(400).json({
      success: false,
      code: 'MISSING_TOKEN',
      message: 'رمز التحديث مطلوب',
    });
  }

  // Verify refresh token
  const decoded = verifyRefreshToken(refreshToken);
  if (!decoded) {
    return res.status(401).json({
      success: false,
      code: 'INVALID_REFRESH_TOKEN',
      message: 'رمز التحديث غير صالح',
    });
  }

  // Check if token exists in database
  const storedTokens = await query(
    `SELECT * FROM refresh_tokens WHERE user_id = ? AND expires_at > NOW()`,
    [decoded.userId]
  );

  let validToken = false;
  for (const stored of storedTokens) {
    if (await bcrypt.compare(refreshToken, stored.token_hash)) {
      validToken = true;
      break;
    }
  }

  if (!validToken) {
    return res.status(401).json({
      success: false,
      code: 'TOKEN_NOT_FOUND',
      message: 'رمز التحديث غير موجود أو منتهي',
    });
  }

  // Get user
  const user = await queryOne(
    'SELECT id, status FROM users WHERE id = ?',
    [decoded.userId]
  );

  if (!user || user.status === 'banned') {
    return res.status(403).json({
      success: false,
      code: 'ACCOUNT_ISSUE',
      message: 'لا يمكن تحديث الرمز',
    });
  }

  // Generate new access token
  const newAccessToken = generateAccessToken(user.id);

  res.json({
    success: true,
    data: {
      accessToken: newAccessToken,
    },
  });
}));

/**
 * POST /api/v1/auth/logout
 * Logout user
 */
router.post('/logout', authenticate, asyncHandler(async (req, res) => {
  const userId = req.user.id;

  // Delete all refresh tokens for user
  await query('DELETE FROM refresh_tokens WHERE user_id = ?', [userId]);

  // Delete Redis session
  await deleteUserSession(userId);

  res.json({
    success: true,
    message: 'تم تسجيل الخروج بنجاح',
  });
}));

/**
 * GET /api/v1/auth/me
 * Get current user info
 */
router.get('/me', authenticate, asyncHandler(async (req, res) => {
  const user = await queryOne(
    `SELECT id, phone, full_name, email, province, wallet_balance, held_balance,
            rating, total_auctions, successful_auctions, is_admin, status, created_at
     FROM users WHERE id = ?`,
    [req.user.id]
  );

  res.json({
    success: true,
    data: {
      user,
    },
  });
}));

// =============================================
// HELPER FUNCTIONS
// =============================================

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

module.exports = router;
