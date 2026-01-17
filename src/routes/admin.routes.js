const express = require('express');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const { verifyToken } = require('../middleware/auth.middleware');

const router = express.Router();

// Multer configuration for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/images');
  },
  filename: (req, file, cb) => {
    const uniqueName = uuidv4() + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) {
      cb(null, true);
    } else {
      cb(new Error('Only images are allowed'));
    }
  }
});

// Middleware to check if user is admin
const isAdmin = async (req, res, next) => {
  try {
    console.log('Admin check for user:', req.user?.userId);
    const [users] = await db.execute(
      'SELECT role FROM users WHERE id = ?',
      [req.user.userId]
    );
    console.log('User found:', users);
    
    if (users.length === 0 || users[0].role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Access denied. Admin only.' });
    }
    next();
  } catch (error) {
    console.error('Admin check error:', error);
    res.status(500).json({ success: false, message: 'Authorization failed' });
  }
};

// =====================================================
// USERS MANAGEMENT
// =====================================================

// GET /api/admin/users - Get all users
router.get('/users', verifyToken, isAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 20, status, search } = req.query;
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 20;
    const offset = (pageNum - 1) * limitNum;

    let query = 'SELECT * FROM users WHERE 1=1';
    const params = [];

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    if (search) {
      query += ' AND (full_name LIKE ? OR phone LIKE ? OR email LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    query += ` ORDER BY created_at DESC LIMIT ${limitNum} OFFSET ${offset}`;

    const [users] = await db.query(query, params);

    // Get total count
    const [countResult] = await db.query('SELECT COUNT(*) as total FROM users');
    const total = countResult[0].total;

    res.json({
      success: true,
      users: users.map(u => ({
        id: u.id,
        fullName: u.full_name,
        phone: u.phone,
        email: u.email,
        avatarUrl: u.avatar_url,
        walletBalance: parseFloat(u.wallet_balance || 0),
        isVerified: u.is_verified,
        isActive: u.is_active,
        role: u.role,
        rating: parseFloat(u.rating || 0),
        totalAuctions: u.total_auctions,
        totalBids: u.total_bids,
        createdAt: u.created_at,
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get Users Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch users' });
  }
});

// GET /api/admin/users/:id - Get user details
router.get('/users/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    console.log('📋 Getting user details for:', id);

    const [users] = await db.execute('SELECT * FROM users WHERE id = ?', [id]);

    if (users.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const user = users[0];

    // Get user's auctions (products they are selling)
    const [userAuctions] = await db.execute(
      `SELECT 
        a.id, a.title, a.current_price, a.status, a.created_at,
        (SELECT COUNT(*) FROM bids WHERE auction_id = a.id) as bids_count,
        (SELECT image_url FROM auction_images WHERE auction_id = a.id AND is_primary = TRUE LIMIT 1) as image
      FROM auctions a 
      WHERE a.seller_id = ? 
      ORDER BY a.created_at DESC
      LIMIT 50`,
      [id]
    );

    // Get user's bids (auctions they bid on)
    const [userBids] = await db.execute(
      `SELECT 
        b.id as bid_id, b.amount, b.created_at as bid_date,
        a.id as auction_id, a.title, a.current_price, a.status,
        (SELECT image_url FROM auction_images WHERE auction_id = a.id AND is_primary = TRUE LIMIT 1) as image,
        (SELECT MAX(amount) FROM bids WHERE auction_id = a.id) as highest_bid
      FROM bids b
      JOIN auctions a ON b.auction_id = a.id
      WHERE b.bidder_id = ?
      ORDER BY b.created_at DESC
      LIMIT 50`,
      [id]
    );

    // Get auctions won by user (where user has highest bid and auction is completed/sold)
    const [wonAuctions] = await db.execute(
      `SELECT 
        a.id, a.title, a.current_price as final_price, a.status, a.end_time,
        (SELECT image_url FROM auction_images WHERE auction_id = a.id AND is_primary = TRUE LIMIT 1) as image
      FROM auctions a
      WHERE a.winner_id = ? AND a.status IN ('sold', 'completed')
      ORDER BY a.end_time DESC
      LIMIT 50`,
      [id]
    );

    // Get auctions lost by user (where user bid but didn't win)
    const [lostAuctions] = await db.execute(
      `SELECT DISTINCT
        a.id, a.title, a.current_price as final_price, a.status, a.end_time,
        (SELECT MAX(amount) FROM bids WHERE auction_id = a.id AND bidder_id = ?) as my_highest_bid,
        (SELECT image_url FROM auction_images WHERE auction_id = a.id AND is_primary = TRUE LIMIT 1) as image
      FROM auctions a
      JOIN bids b ON b.auction_id = a.id AND b.bidder_id = ?
      WHERE a.status IN ('sold', 'completed') 
        AND (a.winner_id IS NULL OR a.winner_id != ?)
      ORDER BY a.end_time DESC
      LIMIT 50`,
      [id, id, id]
    );

    // Format the data for frontend
    console.log('📊 User Bids found:', userBids.length);
    console.log('📊 User Auctions found:', userAuctions.length);
    
    const activeListings = userAuctions.map(a => ({
      id: a.id,
      title: a.title,
      price: parseFloat(a.current_price || 0),
      bids: a.bids_count,
      status: a.status,
      image: a.image
    }));

    const activeBids = userBids.map(b => ({
      id: b.bid_id,
      auctionId: b.auction_id,
      title: b.title,
      myBid: parseFloat(b.amount || 0),
      highestBid: parseFloat(b.highest_bid || 0),
      status: b.status,
      isWinning: parseFloat(b.amount) >= parseFloat(b.highest_bid),
      image: b.image
    }));

    const wonItems = wonAuctions.map(a => ({
      id: a.id,
      title: a.title,
      finalPrice: parseFloat(a.final_price || 0),
      status: a.status,
      date: a.end_time,
      image: a.image
    }));

    const lostItems = lostAuctions.map(a => ({
      id: a.id,
      title: a.title,
      finalPrice: parseFloat(a.final_price || 0),
      myBid: parseFloat(a.my_highest_bid || 0),
      date: a.end_time,
      image: a.image
    }));

    res.json({
      success: true,
      user: {
        id: user.id,
        fullName: user.full_name,
        phone: user.phone,
        email: user.email,
        avatarUrl: user.avatar_url,
        walletBalance: parseFloat(user.wallet_balance || 0),
        isVerified: user.is_verified,
        isActive: user.is_active,
        role: user.role,
        rating: parseFloat(user.rating || 0),
        totalAuctions: userAuctions.length,
        totalBids: userBids.length,
        createdAt: user.created_at,
        // Add detailed lists
        activeListings: activeListings,
        activeBids: activeBids,
        wonItems: wonItems,
        lostItems: lostItems,
      },
    });
  } catch (error) {
    console.error('Get User Details Error:', error.message);
    console.error('Full error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch user details', error: error.message });
  }
});

// PUT /api/admin/users/:id - Update user
router.put('/users/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { fullName, email, isActive, role } = req.body;

    // SECURITY: Prevent setting role to 'admin' via API
    // Only super-admin or database can create new admins
    if (role && role === 'admin') {
      console.warn(`⚠️ SECURITY: Attempted to set admin role for user ${id} by ${req.user.userId}`);
      return res.status(403).json({ success: false, message: 'Cannot set admin role via API' });
    }

    // Only allow valid roles
    const validRoles = ['user', 'seller', 'verified_seller'];
    if (role && !validRoles.includes(role)) {
      return res.status(400).json({ success: false, message: 'Invalid role' });
    }

    await db.execute(
      'UPDATE users SET full_name = COALESCE(?, full_name), email = COALESCE(?, email), is_active = COALESCE(?, is_active), role = COALESCE(?, role) WHERE id = ?',
      [fullName, email, isActive, role, id]
    );

    res.json({ success: true, message: 'User updated successfully' });
  } catch (error) {
    console.error('Update User Error:', error);
    res.status(500).json({ success: false, message: 'Failed to update user' });
  }
});

// POST /api/admin/users/:id/ban - Ban user
router.post('/users/:id/ban', verifyToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    await db.execute(
      'UPDATE users SET is_active = FALSE, ban_reason = ? WHERE id = ?',
      [reason || 'Banned by admin', id]
    );

    res.json({ success: true, message: 'User banned successfully' });
  } catch (error) {
    console.error('Ban User Error:', error);
    res.status(500).json({ success: false, message: 'Failed to ban user' });
  }
});

// POST /api/admin/users/:id/unban - Unban user
router.post('/users/:id/unban', verifyToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    await db.execute(
      'UPDATE users SET is_active = TRUE, ban_reason = NULL WHERE id = ?',
      [id]
    );

    res.json({ success: true, message: 'User unbanned successfully' });
  } catch (error) {
    console.error('Unban User Error:', error);
    res.status(500).json({ success: false, message: 'Failed to unban user' });
  }
});

// DELETE /api/admin/users/:id - Delete user
router.delete('/users/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Don't allow deleting admin users
    const [users] = await db.execute('SELECT role FROM users WHERE id = ?', [id]);
    if (users.length > 0 && users[0].role === 'admin') {
      return res.status(403).json({ success: false, message: 'Cannot delete admin user' });
    }

    await db.execute('DELETE FROM users WHERE id = ?', [id]);

    res.json({ success: true, message: 'User deleted successfully' });
  } catch (error) {
    console.error('Delete User Error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete user' });
  }
});

// =====================================================
// AUCTIONS MANAGEMENT
// =====================================================

// GET /api/admin/auctions - Get all auctions
router.get('/auctions', verifyToken, isAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 20, status, search } = req.query;
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 20;
    const offset = (pageNum - 1) * limitNum;

    let query = `
      SELECT a.*, u.full_name as seller_name, c.name_ar as category_name
      FROM auctions a
      LEFT JOIN users u ON a.seller_id = u.id
      LEFT JOIN categories c ON a.category_id = c.id
      WHERE 1=1
    `;
    const params = [];

    if (status && status !== 'all') {
      query += ' AND a.status = ?';
      params.push(status);
    }

    if (search) {
      query += ' AND (a.title LIKE ? OR a.description LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    query += ` ORDER BY a.created_at DESC LIMIT ${limitNum} OFFSET ${offset}`;

    const [auctions] = await db.query(query, params);

    // Get images for each auction
    for (let auction of auctions) {
      const [images] = await db.query(
        'SELECT image_url FROM auction_images WHERE auction_id = ? ORDER BY sort_order',
        [auction.id]
      );
      auction.images = images.map(img => img.image_url);
    }

    // Get total count
    const [countResult] = await db.query('SELECT COUNT(*) as total FROM auctions');
    const total = countResult[0].total;

    res.json({
      success: true,
      auctions: auctions.map(a => ({
        id: a.id,
        title: a.title,
        description: a.description,
        startingPrice: parseFloat(a.starting_price),
        currentPrice: parseFloat(a.current_price),
        minBidIncrement: parseFloat(a.min_bid_increment),
        buyNowPrice: a.buy_now_price ? parseFloat(a.buy_now_price) : null,
        status: a.status,
        condition: a.condition,
        bidCount: a.bid_count,
        viewCount: a.view_count,
        startTime: a.start_time,
        endTime: a.end_time,
        sellerId: a.seller_id,
        sellerName: a.seller_name,
        categoryId: a.category_id,
        categoryName: a.category_name,
        images: a.images || [],
        createdAt: a.created_at,
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get Auctions Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch auctions' });
  }
});

// PUT /api/admin/auctions/:id - Update auction
router.put('/auctions/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, status, startingPrice, currentPrice } = req.body;

    await db.execute(
      `UPDATE auctions SET 
        title = COALESCE(?, title), 
        description = COALESCE(?, description), 
        status = COALESCE(?, status),
        starting_price = COALESCE(?, starting_price),
        current_price = COALESCE(?, current_price)
      WHERE id = ?`,
      [title, description, status, startingPrice, currentPrice, id]
    );

    res.json({ success: true, message: 'Auction updated successfully' });
  } catch (error) {
    console.error('Update Auction Error:', error);
    res.status(500).json({ success: false, message: 'Failed to update auction' });
  }
});

// DELETE /api/admin/auctions/:id - Delete auction
router.delete('/auctions/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Delete related records first
    await db.execute('DELETE FROM auction_images WHERE auction_id = ?', [id]);
    await db.execute('DELETE FROM bids WHERE auction_id = ?', [id]);
    await db.execute('DELETE FROM watchlist WHERE auction_id = ?', [id]);
    await db.execute('DELETE FROM questions WHERE auction_id = ?', [id]);
    
    // Delete the auction
    await db.execute('DELETE FROM auctions WHERE id = ?', [id]);

    res.json({ success: true, message: 'Auction deleted successfully' });
  } catch (error) {
    console.error('Delete Auction Error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete auction' });
  }
});

// POST /api/admin/auctions/:id/approve - Approve auction
router.post('/auctions/:id/approve', verifyToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    await db.execute(
      "UPDATE auctions SET status = 'active' WHERE id = ?",
      [id]
    );

    res.json({ success: true, message: 'Auction approved successfully' });
  } catch (error) {
    console.error('Approve Auction Error:', error);
    res.status(500).json({ success: false, message: 'Failed to approve auction' });
  }
});

// POST /api/admin/auctions/:id/reject - Reject auction
router.post('/auctions/:id/reject', verifyToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    await db.execute(
      "UPDATE auctions SET status = 'cancelled' WHERE id = ?",
      [id]
    );

    res.json({ success: true, message: 'Auction rejected successfully' });
  } catch (error) {
    console.error('Reject Auction Error:', error);
    res.status(500).json({ success: false, message: 'Failed to reject auction' });
  }
});

// POST /api/admin/auctions - Create auction from admin (company auction)
router.post('/auctions', verifyToken, isAdmin, upload.array('images', 5), async (req, res) => {
  try {
    const { 
      title, 
      description, 
      startingPrice, 
      minBidIncrement, 
      buyNowPrice,
      categoryId, 
      duration,
      condition 
    } = req.body;

    const auctionId = uuidv4();
    const startTime = new Date();
    const endTime = new Date(startTime.getTime() + (parseInt(duration) || 24) * 60 * 60 * 1000);

    // Insert auction with admin as seller (company auction)
    await db.execute(
      `INSERT INTO auctions (
        id, seller_id, category_id, title, description, 
        starting_price, current_price, min_bid_increment, buy_now_price,
        status, \`condition\`, start_time, end_time, is_company_auction
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, 1)`,
      [
        auctionId,
        req.user.userId, // Admin as seller (fixed from req.user.id)
        categoryId,
        title,
        description,
        startingPrice,
        startingPrice,
        minBidIncrement || 1000,
        buyNowPrice || null,
        condition || 'new',
        startTime,
        endTime
      ]
    );

    // Handle uploaded images
    if (req.files && req.files.length > 0) {
      for (let i = 0; i < req.files.length; i++) {
        const file = req.files[i];
        const imageUrl = `/uploads/images/${file.filename}`;
        await db.execute(
          'INSERT INTO auction_images (id, auction_id, image_url, is_primary, sort_order) VALUES (?, ?, ?, ?, ?)',
          [uuidv4(), auctionId, imageUrl, i === 0 ? 1 : 0, i]
        );
      }
    }

    res.json({
      success: true,
      message: 'تم إنشاء المزاد بنجاح',
      auctionId
    });
  } catch (error) {
    console.error('Create Admin Auction Error:', error);
    res.status(500).json({ success: false, message: 'فشل في إنشاء المزاد' });
  }
});

// GET /api/admin/auctions/:id/winner - Get auction winner info
router.get('/auctions/:id/winner', verifyToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Get the highest bidder
    const [bids] = await db.execute(
      `SELECT b.*, u.full_name, u.phone, u.email, u.avatar_url
       FROM bids b
       JOIN users u ON b.bidder_id = u.id
       WHERE b.auction_id = ?
       ORDER BY b.amount DESC
       LIMIT 1`,
      [id]
    );

    if (bids.length === 0) {
      return res.status(404).json({ success: false, message: 'لا يوجد فائز لهذا المزاد' });
    }

    const winner = bids[0];

    // Get auction details
    const [auctions] = await db.execute(
      'SELECT title, current_price, status FROM auctions WHERE id = ?',
      [id]
    );

    res.json({
      success: true,
      winner: {
        id: winner.bidder_id,
        fullName: winner.full_name,
        phone: winner.phone,
        email: winner.email,
        avatarUrl: winner.avatar_url,
        bidAmount: winner.amount,
        bidTime: winner.created_at
      },
      auction: auctions[0]
    });
  } catch (error) {
    console.error('Get Winner Error:', error);
    res.status(500).json({ success: false, message: 'فشل في جلب بيانات الفائز' });
  }
});

// POST /api/admin/auctions/:id/contact-winner - Contact auction winner via WhatsApp
router.post('/auctions/:id/contact-winner', verifyToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { message } = req.body;
    const whatsappService = require('../services/whatsapp.service');

    // Get winner info
    const [bids] = await db.execute(
      `SELECT b.amount, u.full_name, u.phone
       FROM bids b
       JOIN users u ON b.bidder_id = u.id
       WHERE b.auction_id = ?
       ORDER BY b.amount DESC
       LIMIT 1`,
      [id]
    );

    if (bids.length === 0) {
      return res.status(404).json({ success: false, message: 'لا يوجد فائز لهذا المزاد' });
    }

    const winner = bids[0];

    // Get auction details
    const [auctions] = await db.execute(
      'SELECT title, current_price FROM auctions WHERE id = ?',
      [id]
    );

    const auction = auctions[0];

    // Check WhatsApp connection
    const waStatus = whatsappService.getStatus();
    if (!waStatus.isConnected) {
      return res.status(503).json({ success: false, message: 'واتساب غير متصل' });
    }

    // Send message
    const defaultMessage = message || `🎉 مبروك ${winner.full_name}!\n\nلقد فزت بمزاد "${auction.title}" بمبلغ ${winner.amount.toLocaleString()} د.ع\n\nيرجى التواصل معنا لإتمام عملية الشراء.\n\nشكراً لاستخدامك منصة مزاد 🏆`;

    await whatsappService.sendMessage(winner.phone, defaultMessage);

    res.json({
      success: true,
      message: 'تم إرسال الرسالة للفائز بنجاح'
    });
  } catch (error) {
    console.error('Contact Winner Error:', error);
    res.status(500).json({ success: false, message: error.message || 'فشل في إرسال الرسالة' });
  }
});

// =====================================================
// VERIFIED SHOPS MANAGEMENT
// =====================================================

// GET /api/admin/verified-shops - Get all verified shops
router.get('/verified-shops', verifyToken, isAdmin, async (req, res) => {
  try {
    const [shops] = await db.execute(`
      SELECT 
        u.id,
        u.full_name as name,
        u.email,
        u.phone,
        u.avatar_url,
        u.rating,
        u.is_verified,
        u.is_active,
        u.created_at,
        COUNT(DISTINCT a.id) as product_count,
        COUNT(DISTINCT CASE WHEN a.status = 'completed' OR a.status = 'sold' THEN a.id END) as completed_auctions
      FROM users u
      LEFT JOIN auctions a ON a.seller_id = u.id
      WHERE u.is_verified = 1
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `);

    res.json({
      success: true,
      data: shops.map(shop => ({
        id: shop.id,
        name: shop.name,
        email: shop.email,
        phone: shop.phone,
        avatarUrl: shop.avatar_url,
        rating: parseFloat(shop.rating) || 0,
        isVerified: shop.is_verified === 1,
        isActive: shop.is_active === 1,
        productCount: parseInt(shop.product_count) || 0,
        completedAuctions: parseInt(shop.completed_auctions) || 0,
        createdAt: shop.created_at,
      })),
    });
  } catch (error) {
    console.error('Get Verified Shops Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch verified shops' });
  }
});

// POST /api/admin/verified-shops - Add a new verified shop (create user and mark as verified)
router.post('/verified-shops', verifyToken, isAdmin, async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;

    if (!name || !email) {
      return res.status(400).json({ success: false, message: 'الاسم والإيميل مطلوبان' });
    }

    // Check if email already exists
    const [existing] = await db.execute('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length > 0) {
      return res.status(400).json({ success: false, message: 'الإيميل مستخدم مسبقاً' });
    }

    // Create user with verified status
    const bcrypt = require('bcryptjs');
    const crypto = require('crypto');
    
    // SECURITY: Generate random password if not provided
    const randomPassword = crypto.randomBytes(12).toString('base64');
    const finalPassword = password || randomPassword;
    const hashedPassword = await bcrypt.hash(finalPassword, 10);
    const id = uuidv4();

    await db.execute(
      `INSERT INTO users (id, full_name, email, phone, password_hash, is_verified, is_active, role) 
       VALUES (?, ?, ?, ?, ?, 1, 1, 'user')`,
      [id, name, email, phone || null, hashedPassword]
    );

    res.json({
      success: true,
      message: 'تم إضافة المحل المعتمد بنجاح',
      data: { 
        id, 
        name, 
        email, 
        phone,
        // Only return password if it was auto-generated
        temporaryPassword: password ? undefined : finalPassword,
      }
    });
  } catch (error) {
    console.error('Create Verified Shop Error:', error);
    res.status(500).json({ success: false, message: 'Failed to create verified shop' });
  }
});

// PUT /api/admin/verified-shops/:id - Update shop info
router.put('/verified-shops/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, phone } = req.body;

    // Check if email exists for another user
    if (email) {
      const [existing] = await db.execute('SELECT id FROM users WHERE email = ? AND id != ?', [email, id]);
      if (existing.length > 0) {
        return res.status(400).json({ success: false, message: 'الإيميل مستخدم مسبقاً' });
      }
    }

    await db.execute(
      `UPDATE users SET 
        full_name = COALESCE(?, full_name),
        email = COALESCE(?, email),
        phone = COALESCE(?, phone)
       WHERE id = ?`,
      [name, email, phone, id]
    );

    res.json({
      success: true,
      message: 'تم تحديث بيانات المحل بنجاح'
    });
  } catch (error) {
    console.error('Update Verified Shop Error:', error);
    res.status(500).json({ success: false, message: 'Failed to update shop' });
  }
});

// POST /api/admin/users/:id/verify - Mark user as verified shop
router.post('/users/:id/verify', verifyToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    await db.execute('UPDATE users SET is_verified = 1 WHERE id = ?', [id]);

    res.json({
      success: true,
      message: 'تم اعتماد المحل بنجاح'
    });
  } catch (error) {
    console.error('Verify Shop Error:', error);
    res.status(500).json({ success: false, message: 'Failed to verify shop' });
  }
});

// POST /api/admin/users/:id/unverify - Remove verified status
router.post('/users/:id/unverify', verifyToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    await db.execute('UPDATE users SET is_verified = 0 WHERE id = ?', [id]);

    res.json({
      success: true,
      message: 'تم إلغاء اعتماد المحل'
    });
  } catch (error) {
    console.error('Unverify Shop Error:', error);
    res.status(500).json({ success: false, message: 'Failed to unverify shop' });
  }
});

// =====================================================
// DASHBOARD STATS
// =====================================================

// GET /api/admin/stats - Get dashboard statistics
router.get('/stats', verifyToken, isAdmin, async (req, res) => {
  try {
    const [usersCount] = await db.execute('SELECT COUNT(*) as count FROM users');
    const [auctionsCount] = await db.execute('SELECT COUNT(*) as count FROM auctions');
    const [activeAuctionsCount] = await db.execute("SELECT COUNT(*) as count FROM auctions WHERE status = 'active'");
    const [bidsCount] = await db.execute('SELECT COUNT(*) as count FROM bids');
    const [categoriesCount] = await db.execute('SELECT COUNT(*) as count FROM categories');

    // Revenue (sum of all completed auctions)
    const [revenue] = await db.execute(
      "SELECT COALESCE(SUM(current_price), 0) as total FROM auctions WHERE status = 'sold'"
    );

    res.json({
      success: true,
      stats: {
        totalUsers: usersCount[0].count,
        totalAuctions: auctionsCount[0].count,
        activeAuctions: activeAuctionsCount[0].count,
        totalBids: bidsCount[0].count,
        totalCategories: categoriesCount[0].count,
        totalRevenue: parseFloat(revenue[0].total || 0),
      },
    });
  } catch (error) {
    console.error('Get Stats Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch stats' });
  }
});

module.exports = router;
