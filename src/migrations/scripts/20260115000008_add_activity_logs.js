/**
 * Migration: add_activity_logs
 * Created at: 2026-01-15
 * 
 * Adds activity logging for security and audit
 */

module.exports = {
  async up(db) {
    // Create activity_logs table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS activity_logs (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36),
        action VARCHAR(100) NOT NULL,
        entity_type VARCHAR(50),
        entity_id VARCHAR(36),
        old_values JSON,
        new_values JSON,
        ip_address VARCHAR(45),
        user_agent VARCHAR(500),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
        INDEX idx_user (user_id),
        INDEX idx_action (action),
        INDEX idx_entity (entity_type, entity_id),
        INDEX idx_created (created_at DESC)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('   ✓ Created activity_logs table');

    // Create login_attempts table for security
    await db.execute(`
      CREATE TABLE IF NOT EXISTS login_attempts (
        id VARCHAR(36) PRIMARY KEY,
        phone VARCHAR(20),
        email VARCHAR(100),
        ip_address VARCHAR(45) NOT NULL,
        user_agent VARCHAR(500),
        success BOOLEAN DEFAULT FALSE,
        failure_reason VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_phone (phone),
        INDEX idx_email (email),
        INDEX idx_ip (ip_address),
        INDEX idx_created (created_at DESC)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('   ✓ Created login_attempts table');

    // Create blocked_ips table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS blocked_ips (
        id VARCHAR(36) PRIMARY KEY,
        ip_address VARCHAR(45) UNIQUE NOT NULL,
        reason VARCHAR(255),
        blocked_by VARCHAR(36),
        expires_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (blocked_by) REFERENCES users(id) ON DELETE SET NULL,
        INDEX idx_ip (ip_address)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('   ✓ Created blocked_ips table');
  },

  async down(db) {
    await db.execute(`DROP TABLE IF EXISTS blocked_ips`);
    console.log('   ✓ Dropped blocked_ips table');

    await db.execute(`DROP TABLE IF EXISTS login_attempts`);
    console.log('   ✓ Dropped login_attempts table');

    await db.execute(`DROP TABLE IF EXISTS activity_logs`);
    console.log('   ✓ Dropped activity_logs table');
  }
};
