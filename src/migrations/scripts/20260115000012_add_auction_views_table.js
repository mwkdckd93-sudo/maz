/**
 * Migration: add_auction_views_table
 * Created at: 2026-01-15
 * 
 * Adds auction_views table for tracking unique views
 */

module.exports = {
  async up(db) {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS auction_views (
        id VARCHAR(36) PRIMARY KEY,
        auction_id VARCHAR(36) NOT NULL,
        user_id VARCHAR(36),
        ip_address VARCHAR(45),
        user_agent VARCHAR(500),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (auction_id) REFERENCES auctions(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
        INDEX idx_auction (auction_id),
        INDEX idx_user (user_id),
        UNIQUE KEY unique_view (auction_id, user_id, ip_address)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('   ✓ Created auction_views table');
  },

  async down(db) {
    await db.execute(`DROP TABLE IF EXISTS auction_views`);
    console.log('   ✓ Dropped auction_views table');
  }
};
