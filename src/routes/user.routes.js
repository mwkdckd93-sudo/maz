const express = require('express');
const db = require('../config/database');
const urlConfig = require('../config/urls');
const { verifyToken } = require('../middleware/auth.middleware');

const router = express.Router();

// Helper to get full image URL
const getFullImageUrl = (imageUrl) => urlConfig.getImageUrl(imageUrl);
// Helper to convert to relative path for storage
const toRelativePath = (url) => urlConfig.toRelativePath(url);

// =====================================================
// GET CURRENT USER PROFILE
// GET /api/users/me
// =====================================================
router.get('/me', verifyToken, async (req, res) => {
  try {
    const [users] = await db.execute(
      'SELECT * FROM users WHERE id = ?',
      [req.user.userId]
    );

    if (users.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const user = users[0];

    // Get primary address
    const [addresses] = await db.execute(
      'SELECT * FROM addresses WHERE user_id = ? AND is_primary = TRUE LIMIT 1',
      [user.id]
    );

    res.json({
      success: true,
      data: {
        id: user.id,
        fullName: user.full_name,
        phone: user.phone,
        email: user.email,
        avatarUrl: getFullImageUrl(user.avatar_url),
        bio: user.bio || '',
        walletBalance: user.wallet_balance,
        isVerified: user.is_verified,
        rating: user.rating,
        totalAuctions: user.total_auctions,
        totalBids: user.total_bids,
        createdAt: user.created_at,
        primaryAddress: addresses.length > 0 ? {
          id: addresses[0].id,
          city: addresses[0].city,
          area: addresses[0].area,
          street: addresses[0].street,
        } : null,
      },
    });
  } catch (error) {
    console.error('Get Profile Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch profile' });
  }
});

// =====================================================
// UPDATE PROFILE
// PUT /api/users/me
// =====================================================
router.put('/me', verifyToken, async (req, res) => {
  try {
    const { fullName, email, avatarUrl, bio } = req.body;

    // Build dynamic update query
    const updates = [];
    const values = [];

    if (fullName !== undefined) {
      updates.push('full_name = ?');
      values.push(fullName);
    }
    if (email !== undefined) {
      updates.push('email = ?');
      values.push(email || null);
    }
    if (avatarUrl !== undefined) {
      // Remove base URL if present to store relative path
      const storedUrl = toRelativePath(avatarUrl);
      updates.push('avatar_url = ?');
      values.push(storedUrl || null);
    }
    if (bio !== undefined) {
      updates.push('bio = ?');
      values.push(bio || null);
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: 'No fields to update' });
    }

    values.push(req.user.userId);
    await db.execute(
      `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
      values
    );

    // Fetch updated user data
    const [users] = await db.execute('SELECT * FROM users WHERE id = ?', [req.user.userId]);
    const user = users[0];

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        id: user.id,
        fullName: user.full_name,
        email: user.email,
        avatarUrl: getFullImageUrl(user.avatar_url),
        bio: user.bio || '',
      }
    });
  } catch (error) {
    console.error('Update Profile Error:', error);
    res.status(500).json({ success: false, message: 'Failed to update profile' });
  }
});

// =====================================================
// GET USER ADDRESSES
// GET /api/users/addresses
// =====================================================
router.get('/addresses', verifyToken, async (req, res) => {
  try {
    const [addresses] = await db.execute(
      'SELECT * FROM addresses WHERE user_id = ? ORDER BY is_primary DESC',
      [req.user.userId]
    );

    res.json({
      success: true,
      data: addresses.map(a => ({
        id: a.id,
        label: a.label,
        city: a.city,
        area: a.area,
        street: a.street,
        building: a.building,
        notes: a.notes,
        isPrimary: a.is_primary,
      })),
    });
  } catch (error) {
    console.error('Get Addresses Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch addresses' });
  }
});

// =====================================================
// ADD NEW ADDRESS
// POST /api/users/addresses
// =====================================================
router.post('/addresses', verifyToken, async (req, res) => {
  try {
    const { label, city, area, street, building, notes, isPrimary } = req.body;
    const { v4: uuidv4 } = require('uuid');
    const addressId = uuidv4();

    // If this is primary, unset other primary addresses
    if (isPrimary) {
      await db.execute(
        'UPDATE addresses SET is_primary = FALSE WHERE user_id = ?',
        [req.user.userId]
      );
    }

    await db.execute(
      `INSERT INTO addresses (id, user_id, label, city, area, street, building, notes, is_primary)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [addressId, req.user.userId, label || 'المنزل', city, area, street, building, notes, isPrimary || false]
    );

    res.status(201).json({
      success: true,
      data: {
        id: addressId,
        label: label || 'المنزل',
        city,
        area,
        street,
        building,
        notes,
        isPrimary: isPrimary || false,
      },
    });
  } catch (error) {
    console.error('Add Address Error:', error);
    res.status(500).json({ success: false, message: 'Failed to add address' });
  }
});

// =====================================================
// UPDATE ADDRESS
// PUT /api/users/addresses/:id
// =====================================================
router.put('/addresses/:id', verifyToken, async (req, res) => {
  try {
    const { label, city, area, street, building, notes } = req.body;

    // Verify address belongs to user
    const [addresses] = await db.execute(
      'SELECT id FROM addresses WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.userId]
    );

    if (addresses.length === 0) {
      return res.status(404).json({ success: false, message: 'Address not found' });
    }

    await db.execute(
      `UPDATE addresses SET label = ?, city = ?, area = ?, street = ?, building = ?, notes = ? WHERE id = ?`,
      [label, city, area, street, building, notes, req.params.id]
    );

    res.json({ success: true, message: 'Address updated successfully' });
  } catch (error) {
    console.error('Update Address Error:', error);
    res.status(500).json({ success: false, message: 'Failed to update address' });
  }
});

// =====================================================
// DELETE ADDRESS
// DELETE /api/users/addresses/:id
// =====================================================
router.delete('/addresses/:id', verifyToken, async (req, res) => {
  try {
    // Verify address belongs to user
    const [addresses] = await db.execute(
      'SELECT id FROM addresses WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.userId]
    );

    if (addresses.length === 0) {
      return res.status(404).json({ success: false, message: 'Address not found' });
    }

    await db.execute('DELETE FROM addresses WHERE id = ?', [req.params.id]);

    res.json({ success: true, message: 'Address deleted successfully' });
  } catch (error) {
    console.error('Delete Address Error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete address' });
  }
});

// =====================================================
// SET PRIMARY ADDRESS
// PUT /api/users/addresses/:id/primary
// =====================================================
router.put('/addresses/:id/primary', verifyToken, async (req, res) => {
  try {
    // Verify address belongs to user
    const [addresses] = await db.execute(
      'SELECT id FROM addresses WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.userId]
    );

    if (addresses.length === 0) {
      return res.status(404).json({ success: false, message: 'Address not found' });
    }

    // Unset all primary addresses
    await db.execute(
      'UPDATE addresses SET is_primary = FALSE WHERE user_id = ?',
      [req.user.userId]
    );

    // Set this address as primary
    await db.execute(
      'UPDATE addresses SET is_primary = TRUE WHERE id = ?',
      [req.params.id]
    );

    res.json({ success: true, message: 'Primary address updated' });
  } catch (error) {
    console.error('Set Primary Address Error:', error);
    res.status(500).json({ success: false, message: 'Failed to set primary address' });
  }
});

// =====================================================
// GET WALLET BALANCE & TRANSACTIONS
// GET /api/users/wallet
// =====================================================
router.get('/wallet', verifyToken, async (req, res) => {
  try {
    const [users] = await db.execute(
      'SELECT wallet_balance FROM users WHERE id = ?',
      [req.user.userId]
    );

    const [transactions] = await db.execute(
      'SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 20',
      [req.user.userId]
    );

    res.json({
      success: true,
      data: {
        balance: users[0]?.wallet_balance || 0,
        transactions: transactions.map(t => ({
          id: t.id,
          type: t.type,
          amount: t.amount,
          balanceAfter: t.balance_after,
          description: t.description,
          status: t.status,
          createdAt: t.created_at,
        })),
      },
    });
  } catch (error) {
    console.error('Get Wallet Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch wallet' });
  }
});

// =====================================================
// GET MY PRODUCTS (User's own auctions)
// GET /api/users/me/products
// =====================================================
router.get('/me/products', verifyToken, async (req, res) => {
  try {
    const [auctions] = await db.query(`
      SELECT 
        a.*,
        c.name_ar as category_name,
        (SELECT image_url FROM auction_images WHERE auction_id = a.id AND is_primary = TRUE LIMIT 1) as primary_image,
        (SELECT GROUP_CONCAT(image_url) FROM auction_images WHERE auction_id = a.id) as all_images
      FROM auctions a
      JOIN categories c ON a.category_id = c.id
      WHERE a.seller_id = ?
      ORDER BY a.created_at DESC
    `, [req.user.userId]);

    res.json(auctions.map(a => ({
      id: a.id,
      title: a.title,
      description: a.description,
      categoryId: a.category_id,
      categoryName: a.category_name,
      condition: a.condition,
      warranty: { hasWarranty: false },
      images: a.all_images 
        ? a.all_images.split(',').map(img => getFullImageUrl(img))
        : (a.primary_image ? [getFullImageUrl(a.primary_image)] : []),
      sellerId: a.seller_id,
      startingPrice: parseFloat(a.starting_price),
      currentPrice: parseFloat(a.current_price),
      minBidIncrement: parseFloat(a.min_bid_increment),
      bidCount: a.bid_count || 0,
      startTime: a.start_time,
      endTime: a.end_time,
      shippingProvinces: [],
      status: a.status,
      winnerId: a.winner_id,
      isFavorite: false,
      createdAt: a.created_at,
    })));
  } catch (error) {
    console.error('Get My Products Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch products' });
  }
});

// =====================================================
// REQUEST DEPOSIT
// POST /api/users/wallet/deposit
// =====================================================
router.post('/wallet/deposit', verifyToken, async (req, res) => {
  try {
    const { amount } = req.body;
    const { v4: uuidv4 } = require('uuid');

    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid amount' });
    }

    // Create pending deposit transaction
    const transactionId = uuidv4();
    await db.execute(
      `INSERT INTO transactions (id, user_id, type, amount, description, status)
       VALUES (?, ?, 'deposit', ?, 'طلب إيداع رصيد', 'pending')`,
      [transactionId, req.user.userId, amount]
    );

    res.json({
      success: true,
      message: 'تم تقديم طلب الإيداع بنجاح',
      data: { transactionId },
    });
  } catch (error) {
    console.error('Deposit Request Error:', error);
    res.status(500).json({ success: false, message: 'Failed to request deposit' });
  }
});

// =====================================================
// REQUEST WITHDRAWAL
// POST /api/users/wallet/withdraw
// =====================================================
router.post('/wallet/withdraw', verifyToken, async (req, res) => {
  try {
    const { amount } = req.body;
    const { v4: uuidv4 } = require('uuid');

    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid amount' });
    }

    // Check balance
    const [users] = await db.execute(
      'SELECT wallet_balance FROM users WHERE id = ?',
      [req.user.userId]
    );

    if (users[0].wallet_balance < amount) {
      return res.status(400).json({ success: false, message: 'رصيد غير كافٍ' });
    }

    // Create pending withdrawal transaction
    const transactionId = uuidv4();
    await db.execute(
      `INSERT INTO transactions (id, user_id, type, amount, description, status)
       VALUES (?, ?, 'withdrawal', ?, 'طلب سحب رصيد', 'pending')`,
      [transactionId, req.user.userId, amount]
    );

    res.json({
      success: true,
      message: 'تم تقديم طلب السحب بنجاح',
      data: { transactionId },
    });
  } catch (error) {
    console.error('Withdrawal Request Error:', error);
    res.status(500).json({ success: false, message: 'Failed to request withdrawal' });
  }
});

// =====================================================
// GET MY AUCTIONS
// GET /api/users/me/auctions
// =====================================================
router.get('/me/auctions', verifyToken, async (req, res) => {
  try {
    const [auctions] = await db.execute(
      `SELECT a.*, c.name_ar as category_name, u.full_name as seller_name, u.avatar_url as seller_avatar, u.rating as seller_rating,
       (SELECT COUNT(*) FROM bids WHERE auction_id = a.id) as bid_count,
       (SELECT MAX(amount) FROM bids WHERE auction_id = a.id) as highest_bid,
       (SELECT GROUP_CONCAT(image_url ORDER BY sort_order) FROM auction_images WHERE auction_id = a.id) as images
       FROM auctions a
       LEFT JOIN categories c ON a.category_id = c.id
       LEFT JOIN users u ON a.seller_id = u.id
       WHERE a.seller_id = ?
       ORDER BY a.created_at DESC`,
      [req.user.userId]
    );

    res.json({
      success: true,
      data: auctions.map(a => ({
        id: a.id,
        title: a.title,
        description: a.description,
        categoryId: a.category_id,
        categoryName: a.category_name,
        condition: a.condition,
        warranty: { hasWarranty: false },
        images: a.images ? a.images.split(',') : [],
        sellerId: a.seller_id,
        sellerName: a.seller_name,
        sellerAvatar: a.seller_avatar,
        sellerRating: parseFloat(a.seller_rating || 0),
        startingPrice: parseFloat(a.starting_price),
        currentPrice: parseFloat(a.highest_bid || a.starting_price),
        minBidIncrement: parseFloat(a.min_bid_increment),
        bidCount: a.bid_count || 0,
        startTime: a.start_time,
        endTime: a.end_time,
        shippingProvinces: [],
        status: a.status,
        isFavorite: false,
        recentBids: [],
        questions: [],
        createdAt: a.created_at,
      })),
    });
  } catch (error) {
    console.error('Get My Auctions Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch auctions' });
  }
});

// =====================================================
// GET MY BIDS
// GET /api/users/me/bids
// =====================================================
router.get('/me/bids', verifyToken, async (req, res) => {
  try {
    // Get unique auctions where user has placed bids
    const [auctions] = await db.execute(
      `SELECT DISTINCT a.*, c.name_ar as category_name, 
       u.full_name as seller_name, u.avatar_url as seller_avatar, u.rating as seller_rating,
       (SELECT COUNT(*) FROM bids WHERE auction_id = a.id) as bid_count,
       (SELECT MAX(amount) FROM bids WHERE auction_id = a.id) as highest_bid,
       (SELECT GROUP_CONCAT(image_url ORDER BY sort_order) FROM auction_images WHERE auction_id = a.id) as images,
       (SELECT MAX(amount) FROM bids WHERE auction_id = a.id AND bidder_id = ?) as my_highest_bid,
       (SELECT bidder_id FROM bids WHERE auction_id = a.id ORDER BY amount DESC LIMIT 1) as winner_id
       FROM bids b
       JOIN auctions a ON b.auction_id = a.id
       LEFT JOIN categories c ON a.category_id = c.id
       LEFT JOIN users u ON a.seller_id = u.id
       WHERE b.bidder_id = ?
       GROUP BY a.id
       ORDER BY MAX(b.created_at) DESC`,
      [req.user.userId, req.user.userId]
    );

    res.json({
      success: true,
      data: auctions.map(a => ({
        id: a.id,
        title: a.title,
        description: a.description,
        categoryId: a.category_id,
        categoryName: a.category_name,
        condition: a.condition,
        warranty: { hasWarranty: false },
        images: a.images ? a.images.split(',') : [],
        sellerId: a.seller_id,
        sellerName: a.seller_name,
        sellerAvatar: a.seller_avatar,
        sellerRating: parseFloat(a.seller_rating || 0),
        startingPrice: parseFloat(a.starting_price),
        currentPrice: parseFloat(a.highest_bid || a.starting_price),
        minBidIncrement: parseFloat(a.min_bid_increment),
        bidCount: a.bid_count || 0,
        startTime: a.start_time,
        endTime: a.end_time,
        shippingProvinces: [],
        status: a.status,
        winnerId: a.winner_id,
        isFavorite: false,
        recentBids: [],
        questions: [],
        createdAt: a.created_at,
      })),
    });
  } catch (error) {
    console.error('Get My Bids Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch bids' });
  }
});

// =====================================================
// GET VERIFIED SHOPS (PUBLIC)
// GET /api/users/verified-shops
// =====================================================
router.get('/verified-shops', async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const limitNum = parseInt(limit) || 10;
    
    // Get verified users with their product count and average rating
    const [shops] = await db.query(`
      SELECT 
        u.id,
        u.full_name as name,
        u.avatar_url,
        u.rating,
        u.created_at,
        COUNT(DISTINCT a.id) as product_count,
        COUNT(DISTINCT CASE WHEN a.status = 'completed' OR a.status = 'sold' THEN a.id END) as completed_auctions
      FROM users u
      LEFT JOIN auctions a ON a.seller_id = u.id
      WHERE u.is_verified = 1 AND u.is_active = 1
      GROUP BY u.id
      ORDER BY u.rating DESC, product_count DESC
      LIMIT ${limitNum}
    `);

    res.json({
      success: true,
      data: shops.map(shop => ({
        id: shop.id,
        name: shop.name,
        avatarUrl: shop.avatar_url,
        rating: parseFloat(shop.rating) || 4.5,
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

// =====================================================
// GET PUBLIC USER PROFILE
// GET /api/users/:id/profile
// =====================================================
router.get('/:id/profile', async (req, res) => {
  try {
    const { id } = req.params;

    // Get user basic info
    const [users] = await db.execute(`
      SELECT 
        id, full_name, phone, avatar_url, bio, location,
        is_verified, rating, total_auctions, total_bids, created_at
      FROM users 
      WHERE id = ?
    `, [id]);

    if (users.length === 0) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }

    const user = users[0];

    // Get user's auctions count
    const [auctionCount] = await db.execute(`
      SELECT COUNT(*) as count FROM auctions WHERE seller_id = ?
    `, [id]);

    // Get user's reels count
    const [reelsCount] = await db.execute(`
      SELECT COUNT(*) as count FROM reels WHERE user_id = ? AND is_active = TRUE
    `, [id]);

    // Create username from phone (last 4 digits)
    const phone = user.phone || '';
    const username = phone.length >= 4 ? `user_${phone.slice(-4)}` : 'user';

    res.json({
      success: true,
      data: {
        id: user.id,
        fullName: user.full_name,
        username: username,
        bio: user.bio || '',
        location: user.location || '',
        avatarUrl: user.avatar_url,
        isVerified: user.is_verified,
        rating: user.rating || 0,
        totalAuctions: auctionCount[0].count || 0,
        totalBids: user.total_bids || 0,
        totalReels: reelsCount[0].count || 0,
        memberSince: user.created_at,
      },
    });
  } catch (error) {
    console.error('Get Public Profile Error:', error);
    res.status(500).json({ success: false, message: 'فشل في جلب الملف الشخصي' });
  }
});

// =====================================================
// GET USER'S AUCTIONS (Public)
// GET /api/users/:id/auctions
// =====================================================
router.get('/:id/auctions', async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 20, status } = req.query;
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 20;
    const offset = (pageNum - 1) * limitNum;

    let whereClause = 'WHERE a.seller_id = ?';
    const params = [id];

    if (status) {
      whereClause += ' AND a.status = ?';
      params.push(status);
    }

    const [auctions] = await db.query(`
      SELECT 
        a.*,
        (SELECT image_url FROM auction_images WHERE auction_id = a.id AND is_primary = TRUE LIMIT 1) as primary_image,
        c.name as category_name
      FROM auctions a
      LEFT JOIN categories c ON a.category_id = c.id
      ${whereClause}
      ORDER BY a.created_at DESC
      LIMIT ${limitNum} OFFSET ${offset}
    `, params);

    // Get total count
    const [countResult] = await db.execute(`
      SELECT COUNT(*) as total FROM auctions a ${whereClause}
    `, params);

    res.json({
      success: true,
      data: auctions.map(a => ({
        id: a.id,
        title: a.title,
        description: a.description,
        startPrice: a.start_price,
        currentPrice: a.current_price,
        status: a.status,
        endTime: a.end_time,
        bidCount: a.bid_count,
        viewCount: a.view_count,
        primaryImage: a.primary_image,
        categoryName: a.category_name,
        createdAt: a.created_at,
      })),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: countResult[0].total,
        hasMore: offset + auctions.length < countResult[0].total,
      },
    });
  } catch (error) {
    console.error('Get User Auctions Error:', error);
    res.status(500).json({ success: false, message: 'فشل في جلب المزادات' });
  }
});

// =====================================================
// GET USER'S REELS (Public)
// GET /api/users/:id/reels
// =====================================================
router.get('/:id/reels', async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 20;
    const offset = (pageNum - 1) * limitNum;

    const [reels] = await db.query(`
      SELECT 
        r.*,
        a.title as auction_title,
        a.current_price as auction_price,
        (SELECT image_url FROM auction_images WHERE auction_id = a.id AND is_primary = TRUE LIMIT 1) as auction_image
      FROM reels r
      JOIN auctions a ON r.auction_id = a.id
      WHERE r.user_id = ? AND r.is_active = TRUE
      ORDER BY r.created_at DESC
      LIMIT ${limitNum} OFFSET ${offset}
    `, [id]);

    // Get total count
    const [countResult] = await db.execute(`
      SELECT COUNT(*) as total FROM reels WHERE user_id = ? AND is_active = TRUE
    `, [id]);

    res.json({
      success: true,
      data: reels.map(r => ({
        id: r.id,
        videoUrl: `/uploads/reels/${r.video_url.split('/').pop()}`,
        thumbnailUrl: r.thumbnail_url ? `/uploads/reels/thumbnails/${r.thumbnail_url.split('/').pop()}` : null,
        caption: r.caption,
        duration: r.duration,
        likesCount: r.likes_count,
        commentsCount: r.comments_count,
        viewsCount: r.views_count,
        auctionTitle: r.auction_title,
        auctionPrice: r.auction_price,
        auctionImage: r.auction_image,
        createdAt: r.created_at,
      })),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: countResult[0].total,
        hasMore: offset + reels.length < countResult[0].total,
      },
    });
  } catch (error) {
    console.error('Get User Reels Error:', error);
    res.status(500).json({ success: false, message: 'فشل في جلب الريلز' });
  }
});

module.exports = router;
