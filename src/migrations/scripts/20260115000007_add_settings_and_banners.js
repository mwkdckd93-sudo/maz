/**
 * Migration: add_settings_and_banners
 * Created at: 2026-01-15
 * 
 * Adds system settings and promotional banners
 */

module.exports = {
  async up(db) {
    // Create settings table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS settings (
        id VARCHAR(36) PRIMARY KEY,
        \`key\` VARCHAR(100) UNIQUE NOT NULL,
        value TEXT,
        type ENUM('string', 'number', 'boolean', 'json') DEFAULT 'string',
        description VARCHAR(255),
        is_public BOOLEAN DEFAULT FALSE,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('   ✓ Created settings table');

    // Insert default settings
    await db.execute(`
      INSERT IGNORE INTO settings (id, \`key\`, value, type, description, is_public) VALUES
      ('set-1', 'app_name', 'مزاد', 'string', 'Application name', TRUE),
      ('set-2', 'app_name_en', 'Mazad', 'string', 'Application name in English', TRUE),
      ('set-3', 'commission_rate', '5', 'number', 'Default commission rate percentage', FALSE),
      ('set-4', 'min_bid_increment', '5000', 'number', 'Minimum bid increment in IQD', TRUE),
      ('set-5', 'max_auction_days', '30', 'number', 'Maximum auction duration in days', TRUE),
      ('set-6', 'otp_expiry_minutes', '5', 'number', 'OTP expiry time in minutes', FALSE),
      ('set-7', 'support_phone', '+9647700000000', 'string', 'Support phone number', TRUE),
      ('set-8', 'support_email', 'support@mazad.iq', 'string', 'Support email', TRUE),
      ('set-9', 'currency', 'IQD', 'string', 'Default currency', TRUE),
      ('set-10', 'maintenance_mode', 'false', 'boolean', 'Enable maintenance mode', FALSE)
    `);
    console.log('   ✓ Inserted default settings');

    // Create banners table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS banners (
        id VARCHAR(36) PRIMARY KEY,
        title VARCHAR(100),
        title_ar VARCHAR(100),
        image_url VARCHAR(500) NOT NULL,
        link_type ENUM('none', 'auction', 'category', 'shop', 'url') DEFAULT 'none',
        link_id VARCHAR(36),
        link_url VARCHAR(500),
        position ENUM('home_top', 'home_middle', 'category', 'search') DEFAULT 'home_top',
        sort_order INT DEFAULT 0,
        is_active BOOLEAN DEFAULT TRUE,
        starts_at TIMESTAMP NULL,
        ends_at TIMESTAMP NULL,
        click_count INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('   ✓ Created banners table');
  },

  async down(db) {
    await db.execute(`DROP TABLE IF EXISTS banners`);
    console.log('   ✓ Dropped banners table');

    await db.execute(`DROP TABLE IF EXISTS settings`);
    console.log('   ✓ Dropped settings table');
  }
};
