/**
 * Migration: add_reviews_and_reports
 * Created at: 2026-01-15
 * 
 * Adds reviews and reports tables for user feedback
 */

module.exports = {
  async up(db) {
    // Create reviews table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS reviews (
        id VARCHAR(36) PRIMARY KEY,
        auction_id VARCHAR(36) NOT NULL,
        reviewer_id VARCHAR(36) NOT NULL,
        seller_id VARCHAR(36) NOT NULL,
        rating INT NOT NULL CHECK (rating >= 1 AND rating <= 5),
        comment TEXT,
        is_verified_purchase BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (auction_id) REFERENCES auctions(id) ON DELETE CASCADE,
        FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE KEY unique_review (auction_id, reviewer_id),
        INDEX idx_seller (seller_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('   ✓ Created reviews table');

    // Create reports table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS reports (
        id VARCHAR(36) PRIMARY KEY,
        reporter_id VARCHAR(36) NOT NULL,
        reported_type ENUM('auction', 'user', 'review', 'message') NOT NULL,
        reported_id VARCHAR(36) NOT NULL,
        reason ENUM('spam', 'fraud', 'inappropriate', 'counterfeit', 'harassment', 'other') NOT NULL,
        description TEXT,
        status ENUM('pending', 'reviewing', 'resolved', 'dismissed') DEFAULT 'pending',
        admin_notes TEXT,
        resolved_by VARCHAR(36),
        resolved_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL,
        INDEX idx_status (status),
        INDEX idx_type (reported_type)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('   ✓ Created reports table');
  },

  async down(db) {
    await db.execute(`DROP TABLE IF EXISTS reports`);
    console.log('   ✓ Dropped reports table');

    await db.execute(`DROP TABLE IF EXISTS reviews`);
    console.log('   ✓ Dropped reviews table');
  }
};
