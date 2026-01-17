const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const urlConfig = require('../config/urls');
const { verifyToken, optionalAuth } = require('../middleware/auth.middleware');

const router = express.Router();

// Helper function to get full image URL
const getFullImageUrl = (imageUrl) => {
  return urlConfig.getImageUrl(imageUrl);
};

// =====================================================
// GET ALL ACTIVE AUCTIONS (With Filters)
// GET /api/auctions
// =====================================================
router.get('/', optionalAuth, async (req, res) => {
  try {
    const {
      category,
      status = 'active',
      sort = 'ending_soon',
      minPrice,
      maxPrice,
      search,
      seller_id,
      page = 1,
      limit = 20,
    } = req.query;

    const userId = req.user?.userId || null;
    
    let query = `
      SELECT 
        a.*,
        u.full_name as seller_name,
        u.avatar_url as seller_avatar,
        u.rating as seller_rating,
        c.name_ar as category_name,
        (SELECT image_url FROM auction_images WHERE auction_id = a.id AND is_primary = TRUE LIMIT 1) as primary_image,
        ${userId ? '(SELECT COUNT(*) FROM watchlist WHERE auction_id = a.id AND user_id = ?) as is_watched' : '0 as is_watched'}
      FROM auctions a
      JOIN users u ON a.seller_id = u.id
      JOIN categories c ON a.category_id = c.id
      WHERE 1=1
    `;

    const params = userId ? [userId] : [];

    // Status filter (only apply if not filtering by seller)
    if (!seller_id) {
      query += ' AND a.status = ?';
      params.push(status);
    }

    // Seller filter
    if (seller_id) {
      query += ' AND a.seller_id = ?';
      params.push(seller_id);
    }

    // Category filter
    if (category) {
      query += ' AND a.category_id = ?';
      params.push(category);
    }

    // Price filters
    if (minPrice) {
      query += ' AND a.current_price >= ?';
      params.push(parseFloat(minPrice));
    }
    if (maxPrice) {
      query += ' AND a.current_price <= ?';
      params.push(parseFloat(maxPrice));
    }

    // Search
    if (search) {
      query += ' AND (a.title LIKE ? OR a.description LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    // Sorting
    switch (sort) {
      case 'ending_soon':
        query += ' ORDER BY a.end_time ASC';
        break;
      case 'newest':
        query += ' ORDER BY a.created_at DESC';
        break;
      case 'price_low':
        query += ' ORDER BY a.current_price ASC';
        break;
      case 'price_high':
        query += ' ORDER BY a.current_price DESC';
        break;
      case 'most_bids':
        query += ' ORDER BY a.bid_count DESC';
        break;
      default:
        query += ' ORDER BY a.end_time ASC';
    }

    // Pagination
    const offset = (parseInt(page) - 1) * parseInt(limit);
    query += ' LIMIT ? OFFSET ?';
    params.push(parseInt(limit), offset);

    console.log('Query params:', params);
    const [auctions] = await db.query(query, params);

    // Get total count for pagination
    const [countResult] = await db.query(
      'SELECT COUNT(*) as total FROM auctions WHERE status = ?',
      [status]
    );

    res.json({
      success: true,
      auctions: auctions.map(a => ({
        id: a.id,
        title: a.title,
        description: a.description,
        categoryId: a.category_id,
        categoryName: a.category_name,
        condition: a.condition === 'new' ? 'new' : 'used',
        warranty: { hasWarranty: false },
        images: a.primary_image ? [getFullImageUrl(a.primary_image)] : [],
        sellerId: a.seller_id,
        sellerName: a.seller_name,
        sellerAvatar: a.seller_avatar,
        sellerRating: parseFloat(a.seller_rating || 0),
        startingPrice: parseFloat(a.starting_price),
        currentPrice: parseFloat(a.current_price),
        minBidIncrement: parseFloat(a.min_bid_increment),
        bidCount: a.bid_count || 0,
        startTime: a.start_time,
        endTime: a.end_time,
        shippingProvinces: [],
        status: a.status,
        isFavorite: a.is_watched > 0,
        createdAt: a.created_at,
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: countResult[0].total,
        totalPages: Math.ceil(countResult[0].total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get Auctions Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch auctions' });
  }
});

// =====================================================
// GET SINGLE AUCTION
// GET /api/auctions/:id
// =====================================================
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;

    // Get auction details
    const [auctions] = await db.execute(`
      SELECT 
        a.*,
        u.id as seller_id,
        u.full_name as seller_name,
        u.phone as seller_phone,
        u.avatar_url as seller_avatar,
        u.rating as seller_rating,
        u.total_auctions as seller_total_auctions,
        c.name_ar as category_name,
        (SELECT COUNT(*) FROM watchlist WHERE auction_id = a.id AND user_id = ?) as is_watched
      FROM auctions a
      JOIN users u ON a.seller_id = u.id
      JOIN categories c ON a.category_id = c.id
      WHERE a.id = ?
    `, [req.user?.userId || '', id]);

    if (auctions.length === 0) {
      return res.status(404).json({ success: false, message: 'Auction not found' });
    }

    const auction = auctions[0];

    // Get images
    const [images] = await db.execute(
      'SELECT * FROM auction_images WHERE auction_id = ? ORDER BY is_primary DESC, sort_order ASC',
      [id]
    );

    // Get recent bids
    const [bids] = await db.execute(`
      SELECT b.*, u.full_name as bidder_name, u.avatar_url as bidder_avatar
      FROM bids b
      JOIN users u ON b.bidder_id = u.id
      WHERE b.auction_id = ?
      ORDER BY b.amount DESC
      LIMIT 10
    `, [id]);

    // Get highest bidder
    const highestBidderId = bids.length > 0 ? bids[0].bidder_id : null;

    // Get Q&A
    const [questions] = await db.execute(`
      SELECT q.*, u.full_name as asker_name
      FROM questions q
      JOIN users u ON q.user_id = u.id
      WHERE q.auction_id = ? AND q.is_public = TRUE
      ORDER BY q.created_at DESC
    `, [id]);

    // Increment view count
    await db.execute('UPDATE auctions SET view_count = view_count + 1 WHERE id = ?', [id]);

    res.json({
      success: true,
      data: {
        id: auction.id,
        title: auction.title,
        description: auction.description,
        startingPrice: auction.starting_price,
        currentPrice: auction.current_price,
        minBidIncrement: auction.min_bid_increment,
        buyNowPrice: auction.buy_now_price,
        startTime: auction.start_time,
        endTime: auction.end_time,
        status: auction.status,
        bidCount: auction.bid_count,
        viewCount: auction.view_count + 1,
        condition: auction.condition,
        locationCity: auction.location_city,
        isFeatured: auction.is_featured,
        isWatched: auction.is_watched > 0,
        categoryName: auction.category_name,
        highestBidderId: highestBidderId,
        images: images.map(img => ({
          id: img.id,
          url: getFullImageUrl(img.image_url),
          isPrimary: img.is_primary,
        })),
        seller: {
          id: auction.seller_id,
          name: auction.seller_name,
          phone: auction.seller_phone,
          avatar: auction.seller_avatar,
          rating: auction.seller_rating,
          totalAuctions: auction.seller_total_auctions,
        },
        bids: bids.map(b => ({
          id: b.id,
          amount: b.amount,
          bidderName: b.bidder_name,
          bidderAvatar: b.bidder_avatar,
          isAutoBid: b.is_auto_bid,
          createdAt: b.created_at,
        })),
        questions: questions.map(q => ({
          id: q.id,
          question: q.question,
          answer: q.answer,
          askerName: q.asker_name,
          answeredAt: q.answered_at,
          createdAt: q.created_at,
        })),
      },
    });
  } catch (error) {
    console.error('Get Auction Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch auction' });
  }
});

// =====================================================
// CREATE AUCTION
// POST /api/auctions
// =====================================================
router.post('/', verifyToken, async (req, res) => {
  try {
    const {
      title,
      description,
      categoryId,
      startingPrice,
      minBidIncrement = 5000,
      buyNowPrice,
      durationHours = 168, // Default 7 days in hours
      durationDays,
      condition = 'good',
      locationCity,
      images = [],
    } = req.body;

    const auctionId = uuidv4();
    const startTime = new Date();
    
    // Support both durationHours and durationDays
    let durationMs;
    if (durationHours) {
      durationMs = durationHours * 60 * 60 * 1000;
    } else if (durationDays) {
      durationMs = durationDays * 24 * 60 * 60 * 1000;
    } else {
      durationMs = 7 * 24 * 60 * 60 * 1000; // Default 7 days
    }
    
    const endTime = new Date(startTime.getTime() + durationMs);

    // Create auction
    await db.execute(`
      INSERT INTO auctions (
        id, seller_id, category_id, title, description,
        starting_price, current_price, min_bid_increment, buy_now_price,
        start_time, end_time, status, \`condition\`, location_city
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `, [
      auctionId,
      req.user.userId,
      categoryId,
      title,
      description,
      startingPrice,
      startingPrice, // current_price starts at starting_price
      minBidIncrement,
      buyNowPrice || null,
      startTime,
      endTime,
      condition,
      locationCity || null,
    ]);

    // Add images
    for (let i = 0; i < images.length; i++) {
      await db.execute(
        'INSERT INTO auction_images (id, auction_id, image_url, is_primary, sort_order) VALUES (?, ?, ?, ?, ?)',
        [uuidv4(), auctionId, images[i], i === 0, i]
      );
    }

    // Update user's auction count
    await db.execute(
      'UPDATE users SET total_auctions = total_auctions + 1 WHERE id = ?',
      [req.user.userId]
    );

    // Get user info for broadcast
    const [users] = await db.execute('SELECT full_name, avatar_url, rating FROM users WHERE id = ?', [req.user.userId]);
    const [categories] = await db.execute('SELECT name_ar FROM categories WHERE id = ?', [categoryId]);

    // Broadcast new auction to all connected clients via Socket.IO
    const io = req.app.get('io');
    if (io) {
      io.emit('new_auction', {
        id: auctionId,
        title,
        description,
        categoryId,
        categoryName: categories[0]?.name_ar || '',
        condition,
        warranty: { hasWarranty: false },
        images: images.length > 0 ? [images[0]] : [],
        sellerId: req.user.userId,
        sellerName: users[0]?.full_name || '',
        sellerAvatar: users[0]?.avatar_url,
        sellerRating: parseFloat(users[0]?.rating || 0),
        startingPrice: parseFloat(startingPrice),
        currentPrice: parseFloat(startingPrice),
        minBidIncrement: parseFloat(minBidIncrement),
        bidCount: 0,
        startTime: new Date(startTime).toISOString(),
        endTime: new Date(endTime).toISOString(),
        shippingProvinces: [],
        status: 'active',
        isFavorite: false,
        recentBids: [],
        questions: [],
        createdAt: new Date().toISOString(),
      });
      console.log(`📢 Broadcasted new auction: ${auctionId}`);
    }

    res.status(201).json({
      success: true,
      message: 'Auction created successfully',
      data: { id: auctionId },
    });
  } catch (error) {
    console.error('Create Auction Error:', error);
    res.status(500).json({ success: false, message: 'Failed to create auction' });
  }
});

// =====================================================
// GET MY AUCTIONS (As Seller)
// GET /api/auctions/my/listings
// =====================================================
router.get('/my/listings', verifyToken, async (req, res) => {
  try {
    const [auctions] = await db.execute(`
      SELECT 
        a.*,
        c.name_ar as category_name,
        (SELECT image_url FROM auction_images WHERE auction_id = a.id AND is_primary = TRUE LIMIT 1) as primary_image
      FROM auctions a
      JOIN categories c ON a.category_id = c.id
      WHERE a.seller_id = ?
      ORDER BY a.created_at DESC
    `, [req.user.userId]);

    res.json({
      success: true,
      data: auctions.map(a => ({
        id: a.id,
        title: a.title,
        currentPrice: a.current_price,
        bidCount: a.bid_count,
        endTime: a.end_time,
        status: a.status,
        primaryImage: getFullImageUrl(a.primary_image),
        categoryName: a.category_name,
      })),
    });
  } catch (error) {
    console.error('Get My Listings Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch listings' });
  }
});

// =====================================================
// ADD TO WATCHLIST
// POST /api/auctions/:id/watch
// =====================================================
router.post('/:id/watch', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Check if already watching
    const [existing] = await db.execute(
      'SELECT id FROM watchlist WHERE user_id = ? AND auction_id = ?',
      [req.user.userId, id]
    );

    if (existing.length > 0) {
      // Remove from watchlist
      await db.execute(
        'DELETE FROM watchlist WHERE user_id = ? AND auction_id = ?',
        [req.user.userId, id]
      );
      return res.json({ success: true, isWatched: false, message: 'Removed from watchlist' });
    }

    // Add to watchlist
    await db.execute(
      'INSERT INTO watchlist (id, user_id, auction_id) VALUES (?, ?, ?)',
      [uuidv4(), req.user.userId, id]
    );

    res.json({ success: true, isWatched: true, message: 'Added to watchlist' });
  } catch (error) {
    console.error('Watch Auction Error:', error);
    res.status(500).json({ success: false, message: 'Failed to update watchlist' });
  }
});

// =====================================================
// ASK QUESTION
// POST /api/auctions/:id/questions
// =====================================================
router.post('/:id/questions', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { question } = req.body;

    if (!question || question.trim().length < 5) {
      return res.status(400).json({ success: false, message: 'السؤال يجب أن يكون 5 أحرف على الأقل' });
    }

    // Check if auction exists
    const [auctions] = await db.execute('SELECT seller_id FROM auctions WHERE id = ?', [id]);
    if (auctions.length === 0) {
      return res.status(404).json({ success: false, message: 'المزاد غير موجود' });
    }

    // Insert question
    const questionId = uuidv4();
    await db.execute(
      `INSERT INTO questions (id, auction_id, user_id, question, is_public, created_at)
       VALUES (?, ?, ?, ?, TRUE, NOW())`,
      [questionId, id, req.user.userId, question.trim()]
    );

    // Get user name
    const [users] = await db.execute('SELECT full_name FROM users WHERE id = ?', [req.user.userId]);

    res.json({
      success: true,
      message: 'تم إرسال السؤال بنجاح',
      data: {
        id: questionId,
        question: question.trim(),
        askerName: users[0]?.full_name || 'مستخدم',
        answer: null,
        answeredAt: null,
        createdAt: new Date().toISOString(),
      }
    });
  } catch (error) {
    console.error('Ask Question Error:', error);
    res.status(500).json({ success: false, message: 'فشل في إرسال السؤال' });
  }
});

// =====================================================
// ANSWER QUESTION (Seller only)
// PUT /api/auctions/:id/questions/:questionId/answer
// =====================================================
router.put('/:id/questions/:questionId/answer', verifyToken, async (req, res) => {
  try {
    const { id, questionId } = req.params;
    const { answer } = req.body;

    if (!answer || answer.trim().length < 2) {
      return res.status(400).json({ success: false, message: 'الإجابة مطلوبة' });
    }

    // Check if user is seller
    const [auctions] = await db.execute('SELECT seller_id FROM auctions WHERE id = ?', [id]);
    if (auctions.length === 0) {
      return res.status(404).json({ success: false, message: 'المزاد غير موجود' });
    }
    if (auctions[0].seller_id !== req.user.userId) {
      return res.status(403).json({ success: false, message: 'فقط البائع يمكنه الإجابة' });
    }

    // Update question with answer
    await db.execute(
      'UPDATE questions SET answer = ?, answered_at = NOW() WHERE id = ?',
      [answer.trim(), questionId]
    );

    res.json({
      success: true,
      message: 'تم حفظ الإجابة',
      data: { answer: answer.trim(), answeredAt: new Date().toISOString() }
    });
  } catch (error) {
    console.error('Answer Question Error:', error);
    res.status(500).json({ success: false, message: 'فشل في حفظ الإجابة' });
  }
});

module.exports = router;
