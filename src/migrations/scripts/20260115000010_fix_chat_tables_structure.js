/**
 * Migration: fix_chat_tables_structure
 * Created at: 2026-01-15
 * 
 * Fixes chat tables to match the actual usage in chat.routes.js
 * The original migration used different column names
 */

module.exports = {
  async up(db) {
    // Check if conversations table has correct structure
    const [convCols] = await db.execute(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'conversations'
    `);
    const convColumnNames = convCols.map(c => c.COLUMN_NAME);

    // Fix conversations table - add missing columns
    if (!convColumnNames.includes('seller_id')) {
      // Drop and recreate with correct structure
      await db.execute(`DROP TABLE IF EXISTS messages`);
      await db.execute(`DROP TABLE IF EXISTS conversations`);
      
      await db.execute(`
        CREATE TABLE conversations (
          id VARCHAR(36) PRIMARY KEY,
          auction_id VARCHAR(36),
          seller_id VARCHAR(36) NOT NULL,
          buyer_id VARCHAR(36) NOT NULL,
          status ENUM('active', 'closed', 'archived') DEFAULT 'active',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          FOREIGN KEY (auction_id) REFERENCES auctions(id) ON DELETE SET NULL,
          FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE CASCADE,
          INDEX idx_seller (seller_id),
          INDEX idx_buyer (buyer_id),
          INDEX idx_auction (auction_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      console.log('   ✓ Recreated conversations table with correct structure');
    }

    // Check if chat_messages table exists (the code uses chat_messages, not messages)
    const [tables] = await db.execute(`
      SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'chat_messages'
    `);

    if (tables.length === 0) {
      // Create chat_messages table
      await db.execute(`
        CREATE TABLE chat_messages (
          id VARCHAR(36) PRIMARY KEY,
          conversation_id VARCHAR(36) NOT NULL,
          sender_id VARCHAR(36) NOT NULL,
          body TEXT NOT NULL,
          message_type ENUM('text', 'image', 'file', 'system') DEFAULT 'text',
          attachment_url VARCHAR(500),
          is_read BOOLEAN DEFAULT FALSE,
          read_at TIMESTAMP NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
          FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
          INDEX idx_conversation (conversation_id),
          INDEX idx_created (created_at DESC)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      console.log('   ✓ Created chat_messages table');
    }
  },

  async down(db) {
    await db.execute(`DROP TABLE IF EXISTS chat_messages`);
    console.log('   ✓ Dropped chat_messages table');
  }
};
