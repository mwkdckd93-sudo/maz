/**
 * Migration: add_fcm_tokens_table
 * Created at: 2026-01-15
 * 
 * Adds FCM tokens table for push notifications
 */

module.exports = {
  async up(db) {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS fcm_tokens (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        token VARCHAR(500) NOT NULL,
        device_type ENUM('android', 'ios', 'web') DEFAULT 'android',
        device_name VARCHAR(100),
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE KEY unique_token (token),
        INDEX idx_user (user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('   ✓ Created fcm_tokens table');
  },

  async down(db) {
    await db.execute(`DROP TABLE IF EXISTS fcm_tokens`);
    console.log('   ✓ Dropped fcm_tokens table');
  }
};
