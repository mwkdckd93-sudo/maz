/**
 * WhatsApp Service using whatsapp-web.js
 * More stable than Baileys with better reconnection
 */

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const path = require('path');
const fs = require('fs');

class WhatsAppService {
  constructor() {
    this.client = null;
    this.qrCode = null;
    this.isConnected = false;
    this.isInitializing = false;
    this.phoneInfo = null;
    this.lastError = null;
    this.otpStore = new Map(); // Store OTPs temporarily
    
    // Session path
    this.sessionPath = path.join(__dirname, '../../.wwebjs_auth');
  }

  /**
   * Initialize WhatsApp client
   */
  async initialize() {
    if (this.isInitializing) {
      console.log('📱 WhatsApp already initializing...');
      return;
    }

    this.isInitializing = true;
    console.log('📱 Initializing WhatsApp with whatsapp-web.js...');

    try {
      // Create client with LocalAuth for persistent sessions
      this.client = new Client({
        authStrategy: new LocalAuth({
          dataPath: this.sessionPath
        }),
        puppeteer: {
          headless: true,
          executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu',
            '--disable-extensions'
          ]
        }
      });

      // QR Code event
      this.client.on('qr', (qr) => {
        console.log('📱 QR Code received');
        this.qrCode = qr;
        this.isConnected = false;
        
        // Print QR in terminal for debugging
        qrcode.generate(qr, { small: true });
      });

      // Ready event
      this.client.on('ready', async () => {
        console.log('✅ WhatsApp client is ready!');
        this.isConnected = true;
        this.qrCode = null;
        this.lastError = null;
        this.isInitializing = false;
        
        // Patch sendSeen to avoid markedUnread bug
        try {
          await this.client.pupPage.evaluate(() => {
            window.WWebJS.sendSeen = async () => true; // Disable sendSeen
          });
          console.log('✅ SendSeen patched successfully');
        } catch (e) {
          console.log('⚠️ Could not patch sendSeen:', e.message);
        }
        
        // Get phone info
        const info = this.client.info;
        if (info) {
          this.phoneInfo = {
            phone: info.wid.user,
            name: info.pushname,
            platform: info.platform
          };
          console.log('📱 Connected as:', this.phoneInfo.name, '-', this.phoneInfo.phone);
        }
      });

      // Authenticated event
      this.client.on('authenticated', () => {
        console.log('✅ WhatsApp authenticated successfully');
      });

      // Auth failure event
      this.client.on('auth_failure', (msg) => {
        console.error('❌ WhatsApp authentication failed:', msg);
        this.lastError = 'Authentication failed: ' + msg;
        this.isConnected = false;
        this.isInitializing = false;
      });

      // Disconnected event
      this.client.on('disconnected', (reason) => {
        console.log('📱 WhatsApp disconnected:', reason);
        this.isConnected = false;
        this.phoneInfo = null;
        this.qrCode = null;
        this.isInitializing = false;
        
        // Auto reconnect after 5 seconds
        setTimeout(() => {
          console.log('📱 Attempting to reconnect...');
          this.initialize();
        }, 5000);
      });

      // Initialize the client
      await this.client.initialize();
      
    } catch (error) {
      console.error('❌ WhatsApp initialization error:', error);
      this.lastError = error.message;
      this.isInitializing = false;
      
      // Retry after 10 seconds
      setTimeout(() => {
        this.initialize();
      }, 10000);
    }
  }

  /**
   * Get current status
   */
  getStatus() {
    return {
      isConnected: this.isConnected,
      hasQR: !!this.qrCode,
      phoneInfo: this.phoneInfo,
      lastError: this.lastError,
      status: this.isConnected ? 'connected' : (this.qrCode ? 'qr_ready' : 'disconnected')
    };
  }

  /**
   * Get QR code
   */
  getQR() {
    return {
      qr: this.qrCode,
      hasQR: !!this.qrCode,
      status: this.qrCode ? 'qr_ready' : (this.isConnected ? 'connected' : 'waiting')
    };
  }

  /**
   * Disconnect WhatsApp
   */
  async disconnect() {
    if (this.client) {
      try {
        await this.client.logout();
        await this.client.destroy();
      } catch (error) {
        console.error('Error disconnecting:', error);
      }
      
      this.client = null;
      this.isConnected = false;
      this.qrCode = null;
      this.phoneInfo = null;
      
      // Clear session
      if (fs.existsSync(this.sessionPath)) {
        fs.rmSync(this.sessionPath, { recursive: true, force: true });
      }
      
      console.log('📱 WhatsApp disconnected and session cleared');
    }
  }

  /**
   * Send message
   */
  async sendMessage(phone, message) {
    if (!this.isConnected || !this.client) {
      throw new Error('WhatsApp not connected');
    }

    // Format phone number (add country code if needed)
    let formattedPhone = phone.replace(/\D/g, '');
    
    // Handle different formats
    if (formattedPhone.startsWith('07')) {
      // Iraqi local format: 07xxxxxxxxx -> 9647xxxxxxxxx
      formattedPhone = '964' + formattedPhone.substring(1);
    } else if (formattedPhone.startsWith('7') && formattedPhone.length === 10) {
      // Without leading 0: 7xxxxxxxxx -> 9647xxxxxxxxx
      formattedPhone = '964' + formattedPhone;
    } else if (formattedPhone.startsWith('009647')) {
      // International format with 00
      formattedPhone = formattedPhone.substring(2);
    } else if (formattedPhone.startsWith('+9647')) {
      // International format with +
      formattedPhone = formattedPhone.substring(1);
    }
    // If already starts with 964, keep it as is

    console.log(`📱 Sending to formatted number: ${formattedPhone}`);
    
    const chatId = formattedPhone + '@c.us';
    
    try {
      // Check if number is registered first
      const isRegistered = await this.client.isRegisteredUser(chatId);
      if (!isRegistered) {
        throw new Error(`الرقم ${phone} غير مسجل في واتساب`);
      }
      
      // Send message using standard method (sendSeen is patched)
      const result = await this.client.sendMessage(chatId, message);
      console.log('✅ Message sent to:', phone);
      return { success: true, messageId: result.id._serialized };
    } catch (error) {
      console.error('❌ Failed to send message:', error.message);
      console.error(error.stack);
      throw new Error(error.message || 'فشل إرسال الرسالة');
    }
  }

  /**
   * Generate and send OTP
   */
  async sendOTP(phone) {
    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Store OTP with expiry (5 minutes)
    this.otpStore.set(phone, {
      code: otp,
      expiresAt: Date.now() + 5 * 60 * 1000
    });

    // Clean up expired OTPs
    this.cleanExpiredOTPs();

    const message = `🔐 رمز التحقق الخاص بك في مزاد:\n\n*${otp}*\n\nصالح لمدة 5 دقائق.\nلا تشارك هذا الرمز مع أي شخص.`;

    try {
      await this.sendMessage(phone, message);
      return { success: true, message: 'OTP sent successfully' };
    } catch (error) {
      // If WhatsApp fails, return the OTP for SMS fallback
      console.error('WhatsApp send failed, returning OTP for fallback');
      return { success: false, otp: otp, error: error.message };
    }
  }

  /**
   * Verify OTP
   */
  verifyOTP(phone, code) {
    const storedOTP = this.otpStore.get(phone);
    
    if (!storedOTP) {
      return { valid: false, message: 'No OTP found for this number' };
    }

    if (Date.now() > storedOTP.expiresAt) {
      this.otpStore.delete(phone);
      return { valid: false, message: 'OTP expired' };
    }

    if (storedOTP.code === code) {
      this.otpStore.delete(phone);
      return { valid: true, message: 'OTP verified successfully' };
    }

    return { valid: false, message: 'Invalid OTP' };
  }

  /**
   * Clean expired OTPs
   */
  cleanExpiredOTPs() {
    const now = Date.now();
    for (const [phone, data] of this.otpStore.entries()) {
      if (now > data.expiresAt) {
        this.otpStore.delete(phone);
      }
    }
  }

  /**
   * Check if number is registered on WhatsApp
   */
  async isRegisteredUser(phone) {
    if (!this.isConnected || !this.client) {
      return false;
    }

    let formattedPhone = phone.replace(/\D/g, '');
    if (formattedPhone.startsWith('07')) {
      formattedPhone = '964' + formattedPhone.substring(1);
    }

    try {
      const result = await this.client.isRegisteredUser(formattedPhone + '@c.us');
      return result;
    } catch (error) {
      console.error('Error checking registration:', error);
      return false;
    }
  }
}

// Singleton instance
const whatsappService = new WhatsAppService();

module.exports = whatsappService;
