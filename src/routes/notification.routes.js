const express = require('express');
const db = require('../config/database');
const { verifyToken } = require('../middleware/auth.middleware');

const router = express.Router();

// =====================================================
// GET USER NOTIFICATIONS
// GET /api/notifications
// =====================================================
router.get('/', verifyToken, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const [notifications] = await db.execute(`
      SELECT * FROM notifications 
      WHERE user_id = ? 
      ORDER BY created_at DESC 
      LIMIT ? OFFSET ?
    `, [req.user.userId, parseInt(limit), offset]);

    // Get unread count
    const [countResult] = await db.execute(
      'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = FALSE',
      [req.user.userId]
    );

    res.json({
      success: true,
      data: notifications.map(n => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        data: n.data ? JSON.parse(n.data) : null,
        isRead: n.is_read,
        createdAt: n.created_at,
      })),
      unreadCount: countResult[0].count,
    });
  } catch (error) {
    console.error('Get Notifications Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch notifications' });
  }
});

// =====================================================
// MARK NOTIFICATION AS READ
// PUT /api/notifications/:id/read
// =====================================================
router.put('/:id/read', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    await db.execute(
      'UPDATE notifications SET is_read = TRUE WHERE id = ? AND user_id = ?',
      [id, req.user.userId]
    );

    res.json({ success: true, message: 'Notification marked as read' });
  } catch (error) {
    console.error('Mark Read Error:', error);
    res.status(500).json({ success: false, message: 'Failed to update notification' });
  }
});

// =====================================================
// MARK ALL AS READ
// PUT /api/notifications/read-all
// =====================================================
router.put('/read-all', verifyToken, async (req, res) => {
  try {
    await db.execute(
      'UPDATE notifications SET is_read = TRUE WHERE user_id = ?',
      [req.user.userId]
    );

    res.json({ success: true, message: 'All notifications marked as read' });
  } catch (error) {
    console.error('Mark All Read Error:', error);
    res.status(500).json({ success: false, message: 'Failed to update notifications' });
  }
});

module.exports = router;
