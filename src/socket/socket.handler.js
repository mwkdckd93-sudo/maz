const jwt = require('jsonwebtoken');
const db = require('../config/database');
const fs = require('fs');
const path = require('path');

// SECURITY: JWT_SECRET from environment
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.warn('⚠️ WARNING: JWT_SECRET not set for Socket.IO!');
}
const SECRET = JWT_SECRET || 'dev_only_secret_change_in_production';

// Store active connections
const activeConnections = new Map(); // userId -> Set of socket ids
const auctionRooms = new Map(); // auctionId -> Set of socket ids

const setupSocketHandlers = (io) => {
  console.log('🔌 Setting up Socket.IO handlers...');

  io.use((socket, next) => {
    // Optional authentication
    const token = socket.handshake.auth.token;
    if (token) {
      try {
        const decoded = jwt.verify(token, SECRET);
        socket.userId = decoded.userId;
      } catch (err) {
        // Token invalid, continue as guest
      }
    }
    next();
  });

  io.on('connection', (socket) => {
    console.log(`📱 Client connected: ${socket.id}${socket.userId ? ` (User: ${socket.userId})` : ' (Guest)'}`);

    // Join user's personal room for notifications
    if (socket.userId) {
      socket.join(`user_${socket.userId}`);
      
      if (!activeConnections.has(socket.userId)) {
        activeConnections.set(socket.userId, new Set());
      }
      activeConnections.get(socket.userId).add(socket.id);
    }

    // =====================================================
    // JOIN AUCTION ROOM (For real-time bid updates)
    // =====================================================
    socket.on('join_auction', (auctionId) => {
      socket.join(`auction_${auctionId}`);
      
      if (!auctionRooms.has(auctionId)) {
        auctionRooms.set(auctionId, new Set());
      }
      auctionRooms.get(auctionId).add(socket.id);

      console.log(`👁️ Socket ${socket.id} joined auction room: ${auctionId}`);

      // Send current viewer count
      io.to(`auction_${auctionId}`).emit('viewer_count', {
        auctionId,
        count: auctionRooms.get(auctionId).size,
      });
    });

    // =====================================================
    // LEAVE AUCTION ROOM
    // =====================================================
    socket.on('leave_auction', (auctionId) => {
      socket.leave(`auction_${auctionId}`);
      
      if (auctionRooms.has(auctionId)) {
        auctionRooms.get(auctionId).delete(socket.id);
        
        // Update viewer count
        io.to(`auction_${auctionId}`).emit('viewer_count', {
          auctionId,
          count: auctionRooms.get(auctionId).size,
        });
      }

      console.log(`👋 Socket ${socket.id} left auction room: ${auctionId}`);
    });

    // =====================================================
    // REAL-TIME BID (Alternative to REST API)
    // =====================================================
    socket.on('place_bid', async (data) => {
      if (!socket.userId) {
        socket.emit('bid_error', { message: 'Authentication required' });
        return;
      }

      const { auctionId, amount } = data;

      try {
        // Get auction
        const [auctions] = await db.execute(
          'SELECT * FROM auctions WHERE id = ? AND status = "active"',
          [auctionId]
        );

        if (auctions.length === 0) {
          socket.emit('bid_error', { message: 'Auction not found or not active' });
          return;
        }

        const auction = auctions[0];
        const minBid = parseFloat(auction.current_price) + parseFloat(auction.min_bid_increment);

        if (amount < minBid) {
          socket.emit('bid_error', { 
            message: `Minimum bid is ${minBid} IQD`,
            minBid,
          });
          return;
        }

        if (auction.seller_id === socket.userId) {
          socket.emit('bid_error', { message: 'Cannot bid on your own auction' });
          return;
        }

        // Check if user is already the highest bidder
        const [lastBid] = await db.execute(
          'SELECT bidder_id FROM bids WHERE auction_id = ? AND is_winning = TRUE LIMIT 1',
          [auctionId]
        );
        
        if (lastBid.length > 0 && lastBid[0].bidder_id === socket.userId) {
          socket.emit('bid_error', { message: 'أنت صاحب أعلى مزايدة حالياً' });
          return;
        }

        // Create bid
        const bidId = require('uuid').v4();
        await db.execute(
          'INSERT INTO bids (id, auction_id, bidder_id, amount, is_winning) VALUES (?, ?, ?, ?, TRUE)',
          [bidId, auctionId, socket.userId, amount]
        );

        // Update previous winning bids
        await db.execute(
          'UPDATE bids SET is_winning = FALSE WHERE auction_id = ? AND id != ?',
          [auctionId, bidId]
        );

        // Anti-sniping: Check if auction is ending soon (< 10 minutes)
        const endTime = new Date(auction.end_time);
        const now = new Date();
        const timeRemaining = endTime - now;
        const THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes
        const EXTENSION_MS = 10 * 60 * 1000; // Extend to 10 minutes from now if lower
        
        let updatedEndTime = auction.end_time;

        if (timeRemaining < THRESHOLD_MS && timeRemaining > 0) {
          updatedEndTime = new Date(now.getTime() + EXTENSION_MS);
          
          await db.execute(
            'UPDATE auctions SET current_price = ?, bid_count = bid_count + 1, end_time = ? WHERE id = ?',
            [amount, updatedEndTime, auctionId]
          );

          // Emit timer extension
          io.to(`auction_${auctionId}`).emit('timer_extended', {
            auctionId,
            newEndTime: updatedEndTime.toISOString()
          });
        } else {
          // Standard update without time extension
          await db.execute(
            'UPDATE auctions SET current_price = ?, bid_count = bid_count + 1 WHERE id = ?',
            [amount, auctionId]
          );
        }

        // Get bidder info
        const [bidders] = await db.execute(
          'SELECT full_name, avatar_url FROM users WHERE id = ?',
          [socket.userId]
        );

        const bidData = {
          id: bidId,
          auctionId: auctionId,
          bidderId: socket.userId,
          amount,
          bidderName: bidders[0].full_name,
          bidderAvatar: bidders[0].avatar_url,
          createdAt: new Date().toISOString(),
        };

        // Broadcast to all in auction room
        io.to(`auction_${auctionId}`).emit('new_bid', {
          auctionId,
          bid: bidData,
          newPrice: amount,
          bidCount: auction.bid_count + 1,
        });

        // Broadcast GLOBAL update for Home/Category screens
        io.emit('auction_list_update', {
          auctionId,
          newPrice: amount,
          bidCount: auction.bid_count + 1,
          endTime: updatedEndTime // Include updated time
        });

        // Confirm to bidder
        socket.emit('bid_success', {
          auctionId,
          bidId,
          amount,
        });

        // Notify outbid users
        const [previousBidders] = await db.execute(
          'SELECT DISTINCT bidder_id FROM bids WHERE auction_id = ? AND bidder_id != ?',
          [auctionId, socket.userId]
        );

        for (const prev of previousBidders) {
          io.to(`user_${prev.bidder_id}`).emit('outbid', {
            auctionId,
            auctionTitle: auction.title,
            newPrice: amount,
          });
        }

        console.log(`💰 New bid on ${auctionId}: ${amount} IQD by ${socket.userId}`);
      } catch (error) {
        console.error('Socket Bid Error:', error);
        socket.emit('bid_error', { message: 'Failed to place bid' });
      }
    });

    // =====================================================
    // TYPING INDICATOR (For Q&A)
    // =====================================================
    socket.on('typing', (auctionId) => {
      socket.to(`auction_${auctionId}`).emit('user_typing', {
        auctionId,
        userId: socket.userId,
      });
    });

    // =====================================================
    // DISCONNECT
    // =====================================================
    socket.on('disconnect', () => {
      console.log(`📴 Client disconnected: ${socket.id}`);

      // Remove from user connections
      if (socket.userId && activeConnections.has(socket.userId)) {
        activeConnections.get(socket.userId).delete(socket.id);
        if (activeConnections.get(socket.userId).size === 0) {
          activeConnections.delete(socket.userId);
        }
      }

      // Remove from auction rooms and update counts
      for (const [auctionId, sockets] of auctionRooms) {
        if (sockets.has(socket.id)) {
          sockets.delete(socket.id);
          io.to(`auction_${auctionId}`).emit('viewer_count', {
            auctionId,
            count: sockets.size,
          });
        }
      }
    });
  });

  // =====================================================
  // AUCTION END CHECKER (Runs every minute)
  // =====================================================
  setInterval(async () => {
    try {
      // Find auctions that have ended
      const [endedAuctions] = await db.execute(`
        SELECT a.*, 
          (SELECT bidder_id FROM bids WHERE auction_id = a.id AND is_winning = TRUE LIMIT 1) as winner_id
        FROM auctions a 
        WHERE a.status = 'active' AND a.end_time <= NOW()
      `);

      for (const auction of endedAuctions) {
        // Update auction status
        const newStatus = auction.winner_id ? 'sold' : 'ended';
        await db.execute(
          'UPDATE auctions SET status = ?, winner_id = ? WHERE id = ?',
          [newStatus, auction.winner_id || null, auction.id]
        );

        // Notify in auction room
        io.to(`auction_${auction.id}`).emit('auction_ended', {
          auctionId: auction.id,
          status: newStatus,
          winnerId: auction.winner_id,
          finalPrice: auction.current_price,
        });

        // Notify winner
        if (auction.winner_id) {
          io.to(`user_${auction.winner_id}`).emit('auction_won', {
            auctionId: auction.id,
            title: auction.title,
            price: auction.current_price,
            sellerId: auction.seller_id,
          });

          // Create notification for winner
          await db.execute(
            'INSERT INTO notifications (id, user_id, type, title, body, data) VALUES (?, ?, ?, ?, ?, ?)',
            [
              require('uuid').v4(),
              auction.winner_id,
              'auction_won',
              '🎉 مبروك! ربحت المزاد',
              `لقد ربحت مزاد "${auction.title}" بمبلغ ${auction.current_price} د.ع`,
              JSON.stringify({ auctionId: auction.id, price: auction.current_price }),
            ]
          );

          // Create notification for seller about sale
          await db.execute(
            'INSERT INTO notifications (id, user_id, type, title, body, data) VALUES (?, ?, ?, ?, ?, ?)',
            [
              require('uuid').v4(),
              auction.seller_id,
              'auction_sold',
              '💰 تم بيع منتجك!',
              `تم بيع "${auction.title}" بمبلغ ${auction.current_price} د.ع - تواصل مع المشتري`,
              JSON.stringify({ auctionId: auction.id, price: auction.current_price, buyerId: auction.winner_id }),
            ]
          );

          // Auto-create conversation between seller and buyer
          const conversationId = require('uuid').v4();
          await db.execute(
            'INSERT INTO conversations (id, auction_id, seller_id, buyer_id, status) VALUES (?, ?, ?, ?, ?)',
            [conversationId, auction.id, auction.seller_id, auction.winner_id, 'pending']
          );

          // Send system message
          const systemMessageId = require('uuid').v4();
          await db.execute(
            'INSERT INTO chat_messages (id, conversation_id, sender_id, body, message_type) VALUES (?, ?, ?, ?, ?)',
            [
              systemMessageId,
              conversationId,
              auction.seller_id,
              `🎉 مبروك! تم إنهاء المزاد بنجاح. السعر النهائي: ${auction.current_price} د.ع\n\nيرجى التواصل لترتيب عملية التسليم والدفع.`,
              'system'
            ]
          );
        }

        // Notify seller
        io.to(`user_${auction.seller_id}`).emit('auction_ended', {
          auctionId: auction.id,
          status: newStatus,
          finalPrice: auction.current_price,
        });

        // Delete associated reels and their video files
        try {
          // Get reels for this auction
          const [reels] = await db.execute(
            'SELECT id, video_url, thumbnail_url FROM reels WHERE auction_id = ?',
            [auction.id]
          );

          for (const reel of reels) {
            // Delete video file
            if (reel.video_url) {
              const videoPath = path.join(__dirname, '../../', reel.video_url);
              if (fs.existsSync(videoPath)) {
                fs.unlinkSync(videoPath);
                console.log(`🗑️ Deleted video: ${reel.video_url}`);
              }
            }
            // Delete thumbnail file
            if (reel.thumbnail_url) {
              const thumbPath = path.join(__dirname, '../../', reel.thumbnail_url);
              if (fs.existsSync(thumbPath)) {
                fs.unlinkSync(thumbPath);
                console.log(`🗑️ Deleted thumbnail: ${reel.thumbnail_url}`);
              }
            }
          }

          // Delete reels from database
          if (reels.length > 0) {
            await db.execute('DELETE FROM reels WHERE auction_id = ?', [auction.id]);
            console.log(`🗑️ Deleted ${reels.length} reel(s) for auction ${auction.id}`);
          }
        } catch (reelError) {
          console.error(`Error deleting reels for auction ${auction.id}:`, reelError);
        }

        console.log(`⏰ Auction ${auction.id} ended. Status: ${newStatus}`);
      }
    } catch (error) {
      console.error('Auction End Checker Error:', error);
    }
  }, 60000); // Every minute

  console.log('✅ Socket.IO handlers ready');
};

// Helper function to broadcast new auction to all connected clients
const broadcastNewAuction = (io, auction) => {
  io.emit('new_auction', auction);
  console.log(`📢 Broadcasted new auction: ${auction.id}`);
};

// Helper function to broadcast auction update
const broadcastAuctionUpdate = (io, auction) => {
  io.emit('auction_updated', auction);
  console.log(`📢 Broadcasted auction update: ${auction.id}`);
};

module.exports = { setupSocketHandlers, broadcastNewAuction, broadcastAuctionUpdate };
