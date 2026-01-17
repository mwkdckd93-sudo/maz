const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const { verifyToken } = require('../middleware/auth.middleware');

const router = express.Router();

// =====================================================
// GET ALL CONVERSATIONS FOR USER
// GET /api/chat/conversations
// =====================================================
router.get('/conversations', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const [conversations] = await db.query(`
      SELECT 
        c.*,
        a.title as auction_title,
        a.current_price as final_price,
        (SELECT image_url FROM auction_images WHERE auction_id = a.id AND is_primary = TRUE LIMIT 1) as auction_image,
        CASE 
          WHEN c.seller_id = ? THEN buyer.full_name
          ELSE seller.full_name
        END as other_user_name,
        CASE 
          WHEN c.seller_id = ? THEN buyer.avatar_url
          ELSE seller.avatar_url
        END as other_user_avatar,
        CASE 
          WHEN c.seller_id = ? THEN c.buyer_id
          ELSE c.seller_id
        END as other_user_id,
        CASE 
          WHEN c.seller_id = ? THEN 'seller'
          ELSE 'buyer'
        END as my_role,
        (SELECT COUNT(*) FROM chat_messages WHERE conversation_id = c.id AND sender_id != ? AND is_read = FALSE) as unread_count,
        (SELECT body FROM chat_messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message,
        (SELECT created_at FROM chat_messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message_time
      FROM conversations c
      JOIN auctions a ON c.auction_id = a.id
      JOIN users seller ON c.seller_id = seller.id
      JOIN users buyer ON c.buyer_id = buyer.id
      WHERE c.seller_id = ? OR c.buyer_id = ?
      ORDER BY COALESCE(
        (SELECT created_at FROM chat_messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1),
        c.created_at
      ) DESC
    `, [userId, userId, userId, userId, userId, userId, userId]);

    res.json({
      success: true,
      data: conversations.map(c => ({
        id: c.id,
        auctionId: c.auction_id,
        auctionTitle: c.auction_title,
        auctionImage: c.auction_image,
        finalPrice: c.final_price,
        otherUserId: c.other_user_id,
        otherUserName: c.other_user_name,
        otherUserAvatar: c.other_user_avatar,
        myRole: c.my_role,
        unreadCount: c.unread_count,
        lastMessage: c.last_message,
        lastMessageTime: c.last_message_time,
        status: c.status,
        createdAt: c.created_at,
      })),
    });
  } catch (error) {
    console.error('Get Conversations Error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// =====================================================
// GET OR CREATE CONVERSATION FOR AUCTION
// POST /api/chat/conversation
// =====================================================
router.post('/conversation', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { auctionId } = req.body;

    // Get auction details
    const [auctions] = await db.execute(
      'SELECT * FROM auctions WHERE id = ?',
      [auctionId]
    );

    if (auctions.length === 0) {
      return res.status(404).json({ success: false, message: 'Auction not found' });
    }

    const auction = auctions[0];

    // Verify user is either seller or winner
    if (auction.seller_id !== userId && auction.winner_id !== userId) {
      return res.status(403).json({ 
        success: false, 
        message: 'Only seller or winner can access this conversation' 
      });
    }

    // Check if conversation already exists
    const [existing] = await db.execute(
      'SELECT * FROM conversations WHERE auction_id = ?',
      [auctionId]
    );

    if (existing.length > 0) {
      return res.json({
        success: true,
        data: {
          id: existing[0].id,
          auctionId: existing[0].auction_id,
          sellerId: existing[0].seller_id,
          buyerId: existing[0].buyer_id,
          status: existing[0].status,
        },
      });
    }

    // Create new conversation
    const conversationId = uuidv4();
    await db.execute(
      'INSERT INTO conversations (id, auction_id, seller_id, buyer_id, status) VALUES (?, ?, ?, ?, ?)',
      [conversationId, auctionId, auction.seller_id, auction.winner_id, 'active']
    );

    res.json({
      success: true,
      data: {
        id: conversationId,
        auctionId: auctionId,
        sellerId: auction.seller_id,
        buyerId: auction.winner_id,
        status: 'active',
      },
    });
  } catch (error) {
    console.error('Create Conversation Error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// =====================================================
// GET MESSAGES FOR CONVERSATION
// GET /api/chat/messages/:conversationId
// =====================================================
router.get('/messages/:conversationId', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { conversationId } = req.params;
    const { page = 1, limit = 50 } = req.query;

    // Verify user is part of conversation
    const [conversations] = await db.execute(
      'SELECT * FROM conversations WHERE id = ? AND (seller_id = ? OR buyer_id = ?)',
      [conversationId, userId, userId]
    );

    if (conversations.length === 0) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const offset = (parseInt(page) - 1) * parseInt(limit);

    const [messages] = await db.query(`
      SELECT 
        m.*,
        u.full_name as sender_name,
        u.avatar_url as sender_avatar
      FROM chat_messages m
      JOIN users u ON m.sender_id = u.id
      WHERE m.conversation_id = ?
      ORDER BY m.created_at DESC
      LIMIT ? OFFSET ?
    `, [conversationId, parseInt(limit), offset]);

    // Mark messages as read
    await db.execute(
      'UPDATE chat_messages SET is_read = TRUE WHERE conversation_id = ? AND sender_id != ?',
      [conversationId, userId]
    );

    res.json({
      success: true,
      data: messages.reverse().map(m => ({
        id: m.id,
        conversationId: m.conversation_id,
        senderId: m.sender_id,
        senderName: m.sender_name,
        senderAvatar: m.sender_avatar,
        body: m.body,
        messageType: m.message_type,
        attachmentUrl: m.attachment_url,
        isRead: m.is_read,
        createdAt: m.created_at,
      })),
    });
  } catch (error) {
    console.error('Get Messages Error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// =====================================================
// SEND MESSAGE
// POST /api/chat/messages
// =====================================================
router.post('/messages', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { conversationId, body, messageType = 'text', attachmentUrl } = req.body;

    // Verify user is part of conversation
    const [conversations] = await db.execute(
      'SELECT * FROM conversations WHERE id = ? AND (seller_id = ? OR buyer_id = ?)',
      [conversationId, userId, userId]
    );

    if (conversations.length === 0) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const conversation = conversations[0];
    const messageId = uuidv4();

    await db.execute(
      'INSERT INTO chat_messages (id, conversation_id, sender_id, body, message_type, attachment_url) VALUES (?, ?, ?, ?, ?, ?)',
      [messageId, conversationId, userId, body, messageType, attachmentUrl || null]
    );

    // Get sender info
    const [senders] = await db.execute(
      'SELECT full_name, avatar_url FROM users WHERE id = ?',
      [userId]
    );

    const message = {
      id: messageId,
      conversationId,
      senderId: userId,
      senderName: senders[0].full_name,
      senderAvatar: senders[0].avatar_url,
      body,
      messageType,
      attachmentUrl,
      isRead: false,
      createdAt: new Date().toISOString(),
    };

    // Emit via Socket.IO
    const io = req.app.get('io');
    const recipientId = conversation.seller_id === userId 
      ? conversation.buyer_id 
      : conversation.seller_id;

    io.to(`user_${recipientId}`).emit('new_message', message);
    io.to(`conversation_${conversationId}`).emit('new_message', message);

    res.json({
      success: true,
      data: message,
    });
  } catch (error) {
    console.error('Send Message Error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// =====================================================
// UPDATE DELIVERY STATUS
// PUT /api/chat/conversation/:id/status
// =====================================================
router.put('/conversation/:id/status', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;
    const { status } = req.body; // 'pending', 'shipped', 'delivered', 'completed', 'cancelled'

    // Verify user is part of conversation
    const [conversations] = await db.execute(
      'SELECT * FROM conversations WHERE id = ? AND (seller_id = ? OR buyer_id = ?)',
      [id, userId, userId]
    );

    if (conversations.length === 0) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    await db.execute(
      'UPDATE conversations SET status = ? WHERE id = ?',
      [status, id]
    );

    // Emit status update
    const io = req.app.get('io');
    io.to(`conversation_${id}`).emit('status_update', { conversationId: id, status });

    res.json({
      success: true,
      message: 'Status updated',
    });
  } catch (error) {
    console.error('Update Status Error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// =====================================================
// GET AUCTION COMPLETION DETAILS (For winner/seller)
// GET /api/chat/auction/:auctionId/details
// =====================================================
router.get('/auction/:auctionId/details', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { auctionId } = req.params;

    const [auctions] = await db.query(`
      SELECT 
        a.*,
        seller.full_name as seller_name,
        seller.phone as seller_phone,
        seller.avatar_url as seller_avatar,
        seller.rating as seller_rating,
        buyer.full_name as buyer_name,
        buyer.phone as buyer_phone,
        buyer.avatar_url as buyer_avatar,
        c.name_ar as category_name,
        (SELECT GROUP_CONCAT(image_url) FROM auction_images WHERE auction_id = a.id) as images
      FROM auctions a
      JOIN users seller ON a.seller_id = seller.id
      LEFT JOIN users buyer ON a.winner_id = buyer.id
      JOIN categories c ON a.category_id = c.id
      WHERE a.id = ? AND (a.seller_id = ? OR a.winner_id = ?)
    `, [auctionId, userId, userId]);

    if (auctions.length === 0) {
      return res.status(404).json({ success: false, message: 'Auction not found or access denied' });
    }

    const auction = auctions[0];
    const isSeller = auction.seller_id === userId;

    res.json({
      success: true,
      data: {
        id: auction.id,
        title: auction.title,
        description: auction.description,
        finalPrice: auction.current_price,
        status: auction.status,
        categoryName: auction.category_name,
        images: auction.images ? auction.images.split(',') : [],
        shippingProvinces: JSON.parse(auction.shipping_provinces || '[]'),
        endTime: auction.end_time,
        isSeller,
        seller: {
          id: auction.seller_id,
          name: auction.seller_name,
          phone: isSeller ? auction.seller_phone : null, // Only show phone to buyer after purchase
          avatar: auction.seller_avatar,
          rating: auction.seller_rating,
        },
        buyer: auction.winner_id ? {
          id: auction.winner_id,
          name: auction.buyer_name,
          phone: !isSeller ? null : auction.buyer_phone, // Only show phone to seller
          avatar: auction.buyer_avatar,
        } : null,
      },
    });
  } catch (error) {
    console.error('Get Auction Details Error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
