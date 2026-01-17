/**
 * Migration: add_reels_tables
 * Created at: 2026-01-15
 * 
 * Adds reels (short videos) feature for auctions
 */

module.exports = {
  async up(db) {
    // Create reels table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS reels (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        auction_id VARCHAR(36) NOT NULL,
        video_url VARCHAR(500) NOT NULL,
        thumbnail_url VARCHAR(500),
        duration INT DEFAULT 0,
        caption TEXT,
        likes_count INT DEFAULT 0,
        views_count INT DEFAULT 0,
        comments_count INT DEFAULT 0,
        shares_count INT DEFAULT 0,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (auction_id) REFERENCES auctions(id) ON DELETE CASCADE,
        INDEX idx_user (user_id),
        INDEX idx_auction (auction_id),
        INDEX idx_created (created_at DESC),
        INDEX idx_active (is_active)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('   ✓ Created reels table');

    // Create reel_likes table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS reel_likes (
        id VARCHAR(36) PRIMARY KEY,
        reel_id VARCHAR(36) NOT NULL,
        user_id VARCHAR(36) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (reel_id) REFERENCES reels(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE KEY unique_like (reel_id, user_id),
        INDEX idx_reel (reel_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('   ✓ Created reel_likes table');

    // Create reel_comments table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS reel_comments (
        id VARCHAR(36) PRIMARY KEY,
        reel_id VARCHAR(36) NOT NULL,
        user_id VARCHAR(36) NOT NULL,
        comment TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (reel_id) REFERENCES reels(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_reel (reel_id),
        INDEX idx_created (created_at DESC)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('   ✓ Created reel_comments table');

    // Create reel_views table (for tracking unique views)
    await db.execute(`
      CREATE TABLE IF NOT EXISTS reel_views (
        id VARCHAR(36) PRIMARY KEY,
        reel_id VARCHAR(36) NOT NULL,
        user_id VARCHAR(36),
        ip_address VARCHAR(45),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (reel_id) REFERENCES reels(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
        INDEX idx_reel (reel_id),
        INDEX idx_user (user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('   ✓ Created reel_views table');
  },

  async down(db) {
    await db.execute('DROP TABLE IF EXISTS reel_views');
    console.log('   ✓ Dropped reel_views table');

    await db.execute('DROP TABLE IF EXISTS reel_comments');
    console.log('   ✓ Dropped reel_comments table');

    await db.execute('DROP TABLE IF EXISTS reel_likes');
    console.log('   ✓ Dropped reel_likes table');

    await db.execute('DROP TABLE IF EXISTS reels');
    console.log('   ✓ Dropped reels table');
  }
};
