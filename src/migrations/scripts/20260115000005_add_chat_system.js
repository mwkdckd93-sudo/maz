/**
 * Migration: add_chat_system
 * Created at: 2026-01-15
 * 
 * Adds messaging/chat system between buyers and sellers
 */

module.exports = {
  async up(db) {
    // Create conversations table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS conversations (
        id VARCHAR(36) PRIMARY KEY,
        auction_id VARCHAR(36),
        participant_1 VARCHAR(36) NOT NULL,
        participant_2 VARCHAR(36) NOT NULL,
        last_message_at TIMESTAMP NULL,
        last_message_preview VARCHAR(100),
        unread_count_1 INT DEFAULT 0,
        unread_count_2 INT DEFAULT 0,
        is_blocked BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (auction_id) REFERENCES auctions(id) ON DELETE SET NULL,
        FOREIGN KEY (participant_1) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (participant_2) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE KEY unique_conversation (participant_1, participant_2, auction_id),
        INDEX idx_participant_1 (participant_1),
        INDEX idx_participant_2 (participant_2)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('   ✓ Created conversations table');

    // Create messages table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS messages (
        id VARCHAR(36) PRIMARY KEY,
        conversation_id VARCHAR(36) NOT NULL,
        sender_id VARCHAR(36) NOT NULL,
        message_type ENUM('text', 'image', 'file', 'system') DEFAULT 'text',
        content TEXT NOT NULL,
        file_url VARCHAR(500),
        is_read BOOLEAN DEFAULT FALSE,
        read_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
        FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_conversation (conversation_id),
        INDEX idx_created (created_at DESC)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('   ✓ Created messages table');
  },

  async down(db) {
    await db.execute(`DROP TABLE IF EXISTS messages`);
    console.log('   ✓ Dropped messages table');

    await db.execute(`DROP TABLE IF EXISTS conversations`);
    console.log('   ✓ Dropped conversations table');
  }
};
