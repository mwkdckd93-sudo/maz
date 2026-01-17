/**
 * WhatsApp Routes
 * API endpoints for WhatsApp management (Admin only)
 * Updated for whatsapp-web.js
 */

const express = require('express');
const router = express.Router();
const whatsapp = require('../services/whatsapp.service');
const { authenticateToken, requireAdmin } = require('../middleware/auth.middleware');

// =====================================================
// GET /api/whatsapp/status
// Get WhatsApp connection status
// =====================================================
router.get('/status', authenticateToken, requireAdmin, (req, res) => {
  try {
    const status = whatsapp.getStatus();
    
    res.json({
      success: true,
      ...status
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// =====================================================
// GET /api/whatsapp/qr
// Get QR code for scanning
// =====================================================
router.get('/qr', authenticateToken, requireAdmin, (req, res) => {
  try {
    const qrData = whatsapp.getQR();
    
    res.json({
      success: true,
      qr: qrData.qr,
      status: qrData.status,
      hasQR: qrData.hasQR
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// =====================================================
// POST /api/whatsapp/connect
// Start WhatsApp connection
// =====================================================
router.post('/connect', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const status = whatsapp.getStatus();
    
    if (status.isConnected) {
      return res.json({
        success: true,
        message: 'WhatsApp متصل بالفعل',
        status: 'connected'
      });
    }
    
    // Initialize WhatsApp client
    whatsapp.initialize();
    
    res.json({
      success: true,
      message: 'جاري الاتصال... يرجى مسح رمز QR',
      status: 'connecting'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// =====================================================
// POST /api/whatsapp/disconnect
// Logout from WhatsApp
// =====================================================
router.post('/disconnect', authenticateToken, requireAdmin, async (req, res) => {
  try {
    await whatsapp.disconnect();
    
    res.json({
      success: true,
      message: 'تم تسجيل الخروج من WhatsApp'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// =====================================================
// POST /api/whatsapp/reconnect
// Reconnect WhatsApp (clear session and start fresh)
// =====================================================
router.post('/reconnect', authenticateToken, requireAdmin, async (req, res) => {
  try {
    // Disconnect first
    await whatsapp.disconnect();
    
    // Wait a bit then reconnect
    setTimeout(() => {
      whatsapp.initialize();
    }, 2000);
    
    res.json({
      success: true,
      message: 'جاري إعادة الاتصال...',
      status: 'connecting'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// =====================================================
// POST /api/whatsapp/test
// Send test message
// =====================================================
router.post('/test', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { phone, message } = req.body;
    
    if (!phone) {
      return res.status(400).json({
        success: false,
        message: 'رقم الهاتف مطلوب'
      });
    }
    
    const testMessage = message || '🎉 رسالة تجريبية من منصة مزاد\n\nWhatsApp يعمل بنجاح!';
    
    await whatsapp.sendMessage(phone, testMessage);
    
    res.json({
      success: true,
      message: 'تم إرسال الرسالة التجريبية'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// =====================================================
// POST /api/whatsapp/send-otp (Internal use)
// Send OTP to phone number
// =====================================================
router.post('/send-otp', async (req, res) => {
  try {
    const { phone } = req.body;
    
    if (!phone) {
      return res.status(400).json({
        success: false,
        message: 'رقم الهاتف مطلوب'
      });
    }
    
    // Check if WhatsApp is connected
    const status = whatsapp.getStatus();
    if (!status.isConnected) {
      return res.status(503).json({
        success: false,
        message: 'خدمة WhatsApp غير متاحة حالياً',
        fallback: true
      });
    }
    
    const result = await whatsapp.sendOTP(phone);
    
    if (result.success) {
      res.json({
        success: true,
        message: 'تم إرسال رمز التحقق'
      });
    } else {
      // Return OTP for SMS fallback
      res.json({
        success: false,
        message: result.error,
        fallback: true,
        otp: result.otp // For SMS fallback
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// =====================================================
// POST /api/whatsapp/verify-otp (Internal use)
// Verify OTP code
// =====================================================
router.post('/verify-otp', (req, res) => {
  try {
    const { phone, otp } = req.body;
    
    if (!phone || !otp) {
      return res.status(400).json({
        success: false,
        message: 'رقم الهاتف ورمز التحقق مطلوبان'
      });
    }
    
    const result = whatsapp.verifyOTP(phone, otp);
    
    if (result.valid) {
      res.json({
        success: true,
        message: result.message
      });
    } else {
      res.status(400).json({
        success: false,
        message: result.message
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// =====================================================
// GET /api/whatsapp/check/:phone
// Check if phone is registered on WhatsApp
// =====================================================
router.get('/check/:phone', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { phone } = req.params;
    
    const isRegistered = await whatsapp.isRegisteredUser(phone);
    
    res.json({
      success: true,
      phone,
      isRegistered
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;
