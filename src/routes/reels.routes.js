/**
 * Reels Routes
 * Short video content linked to auctions
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const db = require('../config/database');
const { verifyToken, optionalAuth } = require('../middleware/auth.middleware');

const router = express.Router();

// =====================================================
// VIDEO COMPRESSION HELPER
// Compress video to 720p using FFmpeg
// =====================================================
async function compressVideo(inputPath, outputPath) {
  // FFmpeg command to:
  // - Scale to 720p height (maintain aspect ratio)
  // - Use H.264 codec with CRF 28 (good quality/size balance)
  // - Use AAC audio codec
  // - Fast preset for quicker encoding
  const command = `ffmpeg -i "${inputPath}" -vf "scale=-2:720" -c:v libx264 -crf 28 -preset fast -c:a aac -b:a 128k -movflags +faststart -y "${outputPath}"`;
  
  console.log('🎬 Starting video compression...');
  console.log('📁 Input:', inputPath);
  console.log('📁 Output:', outputPath);
  
  try {
    const { stdout, stderr } = await execPromise(command, { timeout: 300000 }); // 5 min timeout
    console.log('✅ Video compression completed');
    return true;
  } catch (error) {
    console.error('❌ FFmpeg Error:', error.message);
    throw new Error('فشل في ضغط الفيديو');
  }
}

// =====================================================
// Get video info using FFprobe
// =====================================================
async function getVideoInfo(filePath) {
  try {
    const command = `ffprobe -v quiet -print_format json -show_format -show_streams "${filePath}"`;
    const { stdout } = await execPromise(command);
    return JSON.parse(stdout);
  } catch (error) {
    console.error('FFprobe Error:', error.message);
    return null;
  }
}

// Video upload configuration
const videoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads/reels');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const videoUpload = multer({
  storage: videoStorage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB max
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('نوع الملف غير مدعوم. يرجى رفع فيديو MP4 أو MOV'));
    }
  }
});

// Thumbnail upload
const thumbnailStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads/reels/thumbnails');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `thumb-${Date.now()}-${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

// =====================================================
// GET ALL REELS (Feed)
// GET /api/reels
// =====================================================
router.get('/', optionalAuth, async (req, res) => {
  try {
    const { page = 1, limit = 10, auctionId, userId: filterUserId } = req.query;
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 10;
    const offset = (pageNum - 1) * limitNum;
    const userId = req.user?.userId;

    let whereClause = 'WHERE r.is_active = TRUE';
    const params = [];

    if (auctionId) {
      whereClause += ' AND r.auction_id = ?';
      params.push(auctionId);
    }

    if (filterUserId) {
      whereClause += ' AND r.user_id = ?';
      params.push(filterUserId);
    }

    // Use query instead of execute for dynamic SQL
    const [reels] = await db.query(`
      SELECT 
        r.*,
        u.full_name as user_name,
        u.avatar_url as user_avatar,
        a.title as auction_title,
        a.current_price as auction_price,
        a.status as auction_status,
        (SELECT image_url FROM auction_images WHERE auction_id = a.id AND is_primary = TRUE LIMIT 1) as auction_image,
        ${userId ? `(SELECT COUNT(*) FROM reel_likes WHERE reel_id = r.id AND user_id = '${userId}') as is_liked` : '0 as is_liked'}
      FROM reels r
      JOIN users u ON r.user_id = u.id
      JOIN auctions a ON r.auction_id = a.id
      ${whereClause}
      ORDER BY r.created_at DESC
      LIMIT ${limitNum} OFFSET ${offset}
    `, params);

    // Get total count
    const [countResult] = await db.query(`
      SELECT COUNT(*) as total FROM reels r ${whereClause}
    `, params);

    res.json({
      success: true,
      data: reels.map(reel => ({
        ...reel,
        is_liked: reel.is_liked > 0,
        video_url: `/uploads/reels/${path.basename(reel.video_url)}`,
        thumbnail_url: reel.thumbnail_url ? `/uploads/reels/thumbnails/${path.basename(reel.thumbnail_url)}` : null
      })),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: countResult[0].total,
        hasMore: offset + reels.length < countResult[0].total
      }
    });
  } catch (error) {
    console.error('Get Reels Error:', error);
    res.status(500).json({ success: false, message: 'فشل في جلب الريلز' });
  }
});

// =====================================================
// GET SINGLE REEL
// GET /api/reels/:id
// =====================================================
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId;

    const [reels] = await db.execute(`
      SELECT 
        r.*,
        u.full_name as user_name,
        u.avatar_url as user_avatar,
        u.id as user_id,
        a.title as auction_title,
        a.current_price as auction_price,
        a.status as auction_status,
        a.end_time as auction_end_time,
        (SELECT image_url FROM auction_images WHERE auction_id = a.id AND is_primary = TRUE LIMIT 1) as auction_image,
        ${userId ? `(SELECT COUNT(*) FROM reel_likes WHERE reel_id = r.id AND user_id = '${userId}') as is_liked` : '0 as is_liked'}
      FROM reels r
      JOIN users u ON r.user_id = u.id
      JOIN auctions a ON r.auction_id = a.id
      WHERE r.id = ? AND r.is_active = TRUE
    `, [id]);

    if (reels.length === 0) {
      return res.status(404).json({ success: false, message: 'الريل غير موجود' });
    }

    const reel = reels[0];

    res.json({
      success: true,
      data: {
        ...reel,
        is_liked: reel.is_liked > 0,
        video_url: `/uploads/reels/${path.basename(reel.video_url)}`,
        thumbnail_url: reel.thumbnail_url ? `/uploads/reels/thumbnails/${path.basename(reel.thumbnail_url)}` : null
      }
    });
  } catch (error) {
    console.error('Get Reel Error:', error);
    res.status(500).json({ success: false, message: 'فشل في جلب الريل' });
  }
});

// =====================================================
// CREATE REEL
// POST /api/reels
// =====================================================
router.post('/', verifyToken, videoUpload.single('video'), async (req, res) => {
  console.log('📹 Reel Upload Request:', { 
    userId: req.user?.userId, 
    body: req.body, 
    file: req.file?.filename 
  });
  
  let originalFilePath = null;
  let compressedFilePath = null;
  
  try {
    const { auctionId, caption, duration } = req.body;
    const userId = req.user.userId;

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'يرجى رفع فيديو' });
    }

    originalFilePath = req.file.path;

    if (!auctionId) {
      fs.unlinkSync(originalFilePath);
      return res.status(400).json({ success: false, message: 'يرجى تحديد المزاد' });
    }

    // Validate duration (max 60 seconds)
    const videoDuration = parseInt(duration) || 0;
    if (videoDuration > 60) {
      // Delete uploaded file
      fs.unlinkSync(originalFilePath);
      return res.status(400).json({ success: false, message: 'أقصى مدة للفيديو هي 60 ثانية' });
    }

    // Verify auction exists and belongs to user or is active
    const [auctions] = await db.execute(
      'SELECT id, seller_id, status FROM auctions WHERE id = ?',
      [auctionId]
    );

    if (auctions.length === 0) {
      fs.unlinkSync(originalFilePath);
      return res.status(404).json({ success: false, message: 'المزاد غير موجود' });
    }

    // =====================================================
    // COMPRESS VIDEO TO 720p
    // =====================================================
    const compressedFileName = `compressed-${req.file.filename}`;
    compressedFilePath = path.join(path.dirname(originalFilePath), compressedFileName);
    
    console.log('🎬 Compressing video to 720p...');
    const originalSize = fs.statSync(originalFilePath).size;
    console.log(`📊 Original size: ${(originalSize / 1024 / 1024).toFixed(2)} MB`);
    
    try {
      await compressVideo(originalFilePath, compressedFilePath);
      
      // Delete original file and rename compressed
      fs.unlinkSync(originalFilePath);
      
      const compressedSize = fs.statSync(compressedFilePath).size;
      console.log(`📊 Compressed size: ${(compressedSize / 1024 / 1024).toFixed(2)} MB`);
      console.log(`📉 Compression ratio: ${((1 - compressedSize / originalSize) * 100).toFixed(1)}% saved`);
      
      // Rename compressed file to original name
      const finalPath = path.join(path.dirname(compressedFilePath), req.file.filename);
      fs.renameSync(compressedFilePath, finalPath);
      compressedFilePath = null; // Clear since we renamed it
      
    } catch (compressionError) {
      console.error('⚠️ Compression failed, using original:', compressionError.message);
      // If compression fails, continue with original file
      if (compressedFilePath && fs.existsSync(compressedFilePath)) {
        fs.unlinkSync(compressedFilePath);
      }
    }

    const reelId = uuidv4();
    const videoUrl = `/uploads/reels/${req.file.filename}`;

    await db.execute(`
      INSERT INTO reels (id, user_id, auction_id, video_url, caption, duration)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [reelId, userId, auctionId, videoUrl, caption || null, videoDuration]);

    res.status(201).json({
      success: true,
      message: 'تم رفع الريل بنجاح',
      data: {
        id: reelId,
        video_url: videoUrl
      }
    });
  } catch (error) {
    console.error('Create Reel Error:', error);
    // Cleanup files on error
    if (originalFilePath && fs.existsSync(originalFilePath)) {
      fs.unlinkSync(originalFilePath);
    }
    if (compressedFilePath && fs.existsSync(compressedFilePath)) {
      fs.unlinkSync(compressedFilePath);
    }
    res.status(500).json({ success: false, message: 'فشل في رفع الريل' });
  }
});

// =====================================================
// UPLOAD THUMBNAIL
// POST /api/reels/:id/thumbnail
// =====================================================
const thumbUpload = multer({ storage: thumbnailStorage });

router.post('/:id/thumbnail', verifyToken, thumbUpload.single('thumbnail'), async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'يرجى رفع صورة مصغرة' });
    }

    // Verify ownership
    const [reels] = await db.execute(
      'SELECT id FROM reels WHERE id = ? AND user_id = ?',
      [id, userId]
    );

    if (reels.length === 0) {
      fs.unlinkSync(req.file.path);
      return res.status(403).json({ success: false, message: 'غير مصرح' });
    }

    const thumbnailUrl = `/uploads/reels/thumbnails/${req.file.filename}`;

    await db.execute(
      'UPDATE reels SET thumbnail_url = ? WHERE id = ?',
      [thumbnailUrl, id]
    );

    res.json({
      success: true,
      message: 'تم رفع الصورة المصغرة',
      data: { thumbnail_url: thumbnailUrl }
    });
  } catch (error) {
    console.error('Upload Thumbnail Error:', error);
    res.status(500).json({ success: false, message: 'فشل في رفع الصورة المصغرة' });
  }
});

// =====================================================
// LIKE/UNLIKE REEL
// POST /api/reels/:id/like
// =====================================================
router.post('/:id/like', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    // Check if already liked
    const [existing] = await db.execute(
      'SELECT id FROM reel_likes WHERE reel_id = ? AND user_id = ?',
      [id, userId]
    );

    if (existing.length > 0) {
      // Unlike
      await db.execute('DELETE FROM reel_likes WHERE reel_id = ? AND user_id = ?', [id, userId]);
      await db.execute('UPDATE reels SET likes_count = likes_count - 1 WHERE id = ?', [id]);
      
      res.json({ success: true, liked: false, message: 'تم إلغاء الإعجاب' });
    } else {
      // Like
      await db.execute(
        'INSERT INTO reel_likes (id, reel_id, user_id) VALUES (?, ?, ?)',
        [uuidv4(), id, userId]
      );
      await db.execute('UPDATE reels SET likes_count = likes_count + 1 WHERE id = ?', [id]);
      
      res.json({ success: true, liked: true, message: 'تم الإعجاب' });
    }
  } catch (error) {
    console.error('Like Reel Error:', error);
    res.status(500).json({ success: false, message: 'فشل في تحديث الإعجاب' });
  }
});

// =====================================================
// ADD VIEW
// POST /api/reels/:id/view
// =====================================================
router.post('/:id/view', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId;
    const ipAddress = req.ip || req.headers['x-forwarded-for'];

    // Simple rate limiting - only count unique views per user/IP per hour
    const [existing] = await db.execute(`
      SELECT id FROM reel_views 
      WHERE reel_id = ? AND (user_id = ? OR ip_address = ?)
      AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)
    `, [id, userId || 'none', ipAddress]);

    if (existing.length === 0) {
      await db.execute(
        'INSERT INTO reel_views (id, reel_id, user_id, ip_address) VALUES (?, ?, ?, ?)',
        [uuidv4(), id, userId || null, ipAddress]
      );
      await db.execute('UPDATE reels SET views_count = views_count + 1 WHERE id = ?', [id]);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('View Reel Error:', error);
    res.status(500).json({ success: false });
  }
});

// =====================================================
// GET COMMENTS
// GET /api/reels/:id/comments
// =====================================================
router.get('/:id/comments', async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 20;
    const offset = (pageNum - 1) * limitNum;

    // Use query instead of execute for dynamic LIMIT/OFFSET
    const [comments] = await db.query(`
      SELECT 
        c.*,
        u.full_name as user_name,
        u.avatar_url as user_avatar
      FROM reel_comments c
      JOIN users u ON c.user_id = u.id
      WHERE c.reel_id = ?
      ORDER BY c.created_at DESC
      LIMIT ${limitNum} OFFSET ${offset}
    `, [id]);

    res.json({
      success: true,
      data: comments
    });
  } catch (error) {
    console.error('Get Comments Error:', error);
    res.status(500).json({ success: false, message: 'فشل في جلب التعليقات' });
  }
});

// =====================================================
// ADD COMMENT
// POST /api/reels/:id/comments
// =====================================================
router.post('/:id/comments', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { comment } = req.body;
    const userId = req.user.userId;

    if (!comment || comment.trim().length === 0) {
      return res.status(400).json({ success: false, message: 'يرجى كتابة تعليق' });
    }

    const commentId = uuidv4();

    await db.execute(
      'INSERT INTO reel_comments (id, reel_id, user_id, comment) VALUES (?, ?, ?, ?)',
      [commentId, id, userId, comment.trim()]
    );

    await db.execute('UPDATE reels SET comments_count = comments_count + 1 WHERE id = ?', [id]);

    // Get user info for response
    const [users] = await db.execute(
      'SELECT full_name, avatar_url FROM users WHERE id = ?',
      [userId]
    );

    res.status(201).json({
      success: true,
      message: 'تم إضافة التعليق',
      data: {
        id: commentId,
        comment: comment.trim(),
        user_name: users[0]?.full_name,
        user_avatar: users[0]?.avatar_url,
        created_at: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Add Comment Error:', error);
    res.status(500).json({ success: false, message: 'فشل في إضافة التعليق' });
  }
});

// =====================================================
// DELETE REEL
// DELETE /api/reels/:id
// =====================================================
router.delete('/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    // Check ownership
    const [reels] = await db.execute(
      'SELECT id, video_url, thumbnail_url FROM reels WHERE id = ? AND user_id = ?',
      [id, userId]
    );

    if (reels.length === 0) {
      return res.status(403).json({ success: false, message: 'غير مصرح بحذف هذا الريل' });
    }

    // Delete files
    const reel = reels[0];
    try {
      if (reel.video_url) {
        const videoPath = path.join(__dirname, '../..', reel.video_url);
        if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
      }
      if (reel.thumbnail_url) {
        const thumbPath = path.join(__dirname, '../..', reel.thumbnail_url);
        if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
      }
    } catch (e) {
      console.error('Error deleting reel files:', e);
    }

    // Delete from database (cascade will handle likes, comments, views)
    await db.execute('DELETE FROM reels WHERE id = ?', [id]);

    res.json({ success: true, message: 'تم حذف الريل' });
  } catch (error) {
    console.error('Delete Reel Error:', error);
    res.status(500).json({ success: false, message: 'فشل في حذف الريل' });
  }
});

// =====================================================
// GET USER'S REELS
// GET /api/reels/user/:userId
// =====================================================
router.get('/user/:userId', optionalAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 20;
    const offset = (pageNum - 1) * limitNum;
    const currentUserId = req.user?.userId;

    // Use query instead of execute for dynamic SQL with LIMIT/OFFSET
    const [reels] = await db.query(`
      SELECT 
        r.*,
        u.full_name as user_name,
        u.avatar_url as user_avatar,
        a.title as auction_title,
        a.current_price as auction_price,
        ${currentUserId ? `(SELECT COUNT(*) FROM reel_likes WHERE reel_id = r.id AND user_id = '${currentUserId}') as is_liked` : '0 as is_liked'}
      FROM reels r
      JOIN users u ON r.user_id = u.id
      JOIN auctions a ON r.auction_id = a.id
      WHERE r.user_id = ? AND r.is_active = TRUE
      ORDER BY r.created_at DESC
      LIMIT ${limitNum} OFFSET ${offset}
    `, [userId]);

    res.json({
      success: true,
      data: reels.map(reel => ({
        ...reel,
        is_liked: reel.is_liked > 0,
        video_url: `/uploads/reels/${path.basename(reel.video_url)}`,
        thumbnail_url: reel.thumbnail_url ? `/uploads/reels/thumbnails/${path.basename(reel.thumbnail_url)}` : null
      }))
    });
  } catch (error) {
    console.error('Get User Reels Error:', error);
    res.status(500).json({ success: false, message: 'فشل في جلب ريلز المستخدم' });
  }
});

module.exports = router;
