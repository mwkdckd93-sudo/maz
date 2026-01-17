const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const { verifyToken } = require('../middleware/auth.middleware');

const router = express.Router();

// =====================================================
// PLACE BID
// POST /api/bids
// =====================================================
router.post('/', verifyToken, async (req, res) => {
  const connection = await db.getConnection();
  
  try {
    await connection.beginTransaction();

    const { auctionId, amount, isAutoBid = false, maxAutoBid } = req.body;
    const bidderId = req.user.userId;

    // Get auction details
    const [auctions] = await connection.execute(
      'SELECT * FROM auctions WHERE id = ? FOR UPDATE',
      [auctionId]
    );

    if (auctions.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'Auction not found' });
    }

    const auction = auctions[0];

    // Validation checks
    if (auction.status !== 'active') {
      await connection.rollback();
      return res.status(400).json({ success: false, message: 'Auction is not active' });
    }

    if (new Date(auction.end_time) < new Date()) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: 'Auction has ended' });
    }

    if (auction.seller_id === bidderId) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: 'Cannot bid on your own auction' });
    }

    // Check if user is already the highest bidder
    const [lastWinningBid] = await connection.execute(
      'SELECT bidder_id FROM bids WHERE auction_id = ? AND is_winning = TRUE LIMIT 1',
      [auctionId]
    );
    
    if (lastWinningBid.length > 0 && lastWinningBid[0].bidder_id === bidderId) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: 'أنت صاحب أعلى مزايدة حالياً' });
    }

    const minBid = parseFloat(auction.current_price) + parseFloat(auction.min_bid_increment);
    if (amount < minBid) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: `Minimum bid is ${minBid} IQD`,
        minBid,
      });
    }

    // Create bid
    const bidId = uuidv4();
    await connection.execute(
      'INSERT INTO bids (id, auction_id, bidder_id, amount, is_auto_bid, max_auto_bid, is_winning) VALUES (?, ?, ?, ?, ?, ?, TRUE)',
      [bidId, auctionId, bidderId, amount, isAutoBid, maxAutoBid || null]
    );

    // Update previous winning bid
    await connection.execute(
      'UPDATE bids SET is_winning = FALSE WHERE auction_id = ? AND id != ?',
      [auctionId, bidId]
    );

    // Update auction
    await connection.execute(
      'UPDATE auctions SET current_price = ?, bid_count = bid_count + 1 WHERE id = ?',
      [amount, auctionId]
    );

    // Update user's bid count
    await connection.execute(
      'UPDATE users SET total_bids = total_bids + 1 WHERE id = ?',
      [bidderId]
    );

    await connection.commit();

    // Get bidder info for socket broadcast
    const [bidders] = await db.execute(
      'SELECT full_name, avatar_url FROM users WHERE id = ?',
      [bidderId]
    );
    const bidder = bidders[0];

    // Emit real-time update via Socket.IO
    const io = req.app.get('io');
    if (io) {
      console.log(`📢 Broadcasting new_bid to auction_${auctionId}`);
      
      // Broadcast to auction room
      io.to(`auction_${auctionId}`).emit('new_bid', {
        auctionId,
        bid: {
          id: bidId,
          amount,
          bidderId: bidderId,
          bidderName: bidder.full_name,
          bidderAvatar: bidder.avatar_url,
          createdAt: new Date().toISOString(),
        },
        bidderId: bidderId,
        newPrice: amount,
        bidCount: auction.bid_count + 1,
      });

      // Also broadcast global update for screens that might not be in the room
      io.emit('auction_list_update', {
        auctionId,
        newPrice: amount,
        bidCount: auction.bid_count + 1,
        bidderId: bidderId,
      });

      // Notify previous bidders that they've been outbid
      const [previousBidders] = await db.execute(
        'SELECT DISTINCT bidder_id FROM bids WHERE auction_id = ? AND bidder_id != ?',
        [auctionId, bidderId]
      );

      for (const prev of previousBidders) {
        io.to(`user_${prev.bidder_id}`).emit('outbid', {
          auctionId,
          auctionTitle: auction.title,
          newPrice: amount,
        });

        // Create notification
        await db.execute(
          'INSERT INTO notifications (id, user_id, type, title, body, data) VALUES (?, ?, ?, ?, ?, ?)',
          [
            uuidv4(),
            prev.bidder_id,
            'bid_outbid',
            'تمت المزايدة عليك!',
            `شخص آخر زايد على "${auction.title}" بمبلغ ${amount} د.ع`,
            JSON.stringify({ auctionId, amount }),
          ]
        );
      }
    }

    res.status(201).json({
      success: true,
      message: 'Bid placed successfully',
      data: {
        bidId,
        amount,
        newPrice: amount,
        bidCount: auction.bid_count + 1,
      },
    });
  } catch (error) {
    await connection.rollback();
    console.error('Place Bid Error:', error);
    res.status(500).json({ success: false, message: 'Failed to place bid' });
  } finally {
    connection.release();
  }
});

// =====================================================
// GET MY BIDS
// GET /api/bids/my
// =====================================================
router.get('/my', verifyToken, async (req, res) => {
  try {
    const [bids] = await db.execute(`
      SELECT 
        b.*,
        a.id as auction_id,
        a.title as auction_title,
        a.current_price,
        a.end_time,
        a.status as auction_status,
        (SELECT image_url FROM auction_images WHERE auction_id = a.id AND is_primary = TRUE LIMIT 1) as primary_image,
        (b.amount = a.current_price AND b.is_winning = TRUE) as is_winning
      FROM bids b
      JOIN auctions a ON b.auction_id = a.id
      WHERE b.bidder_id = ?
      ORDER BY b.created_at DESC
    `, [req.user.userId]);

    // Group by auction (latest bid per auction)
    const auctionBids = {};
    for (const bid of bids) {
      if (!auctionBids[bid.auction_id]) {
        auctionBids[bid.auction_id] = {
          auctionId: bid.auction_id,
          auctionTitle: bid.auction_title,
          currentPrice: bid.current_price,
          myLastBid: bid.amount,
          endTime: bid.end_time,
          auctionStatus: bid.auction_status,
          primaryImage: bid.primary_image,
          isWinning: bid.is_winning,
          totalMyBids: 0,
        };
      }
      auctionBids[bid.auction_id].totalMyBids++;
    }

    res.json({
      success: true,
      data: Object.values(auctionBids),
    });
  } catch (error) {
    console.error('Get My Bids Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch bids' });
  }
});

// =====================================================
// GET AUCTION BID HISTORY
// GET /api/bids/auction/:auctionId
// =====================================================
router.get('/auction/:auctionId', async (req, res) => {
  try {
    const { auctionId } = req.params;
    const { limit = 50 } = req.query;

    const [bids] = await db.execute(`
      SELECT 
        b.*,
        u.full_name as bidder_name,
        u.avatar_url as bidder_avatar
      FROM bids b
      JOIN users u ON b.bidder_id = u.id
      WHERE b.auction_id = ?
      ORDER BY b.created_at DESC
      LIMIT ?
    `, [auctionId, parseInt(limit)]);

    res.json({
      success: true,
      data: bids.map(b => ({
        id: b.id,
        amount: b.amount,
        bidderName: b.bidder_name,
        bidderAvatar: b.bidder_avatar,
        isAutoBid: b.is_auto_bid,
        isWinning: b.is_winning,
        createdAt: b.created_at,
      })),
    });
  } catch (error) {
    console.error('Get Bid History Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch bid history' });
  }
});

module.exports = router;
