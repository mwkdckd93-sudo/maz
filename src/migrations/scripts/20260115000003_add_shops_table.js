/**
 * Migration: add_shops_table
 * Created at: 2026-01-15
 * 
 * Adds shops/vendors table for multi-vendor support
 */

module.exports = {
  async up(db) {
    // Create shops table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS shops (
        id VARCHAR(36) PRIMARY KEY,
        owner_id VARCHAR(36) NOT NULL,
        name VARCHAR(100) NOT NULL,
        name_ar VARCHAR(100),
        description TEXT,
        logo_url VARCHAR(500),
        cover_url VARCHAR(500),
        phone VARCHAR(20),
        email VARCHAR(100),
        address TEXT,
        city VARCHAR(50),
        rating DECIMAL(3, 2) DEFAULT 0,
        total_sales INT DEFAULT 0,
        commission_rate DECIMAL(5, 2) DEFAULT 5.00,
        is_verified BOOLEAN DEFAULT FALSE,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_owner (owner_id),
        INDEX idx_active (is_active)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('   ✓ Created shops table');

    // Add shop_id to auctions
    await db.execute(`
      ALTER TABLE auctions 
      ADD COLUMN shop_id VARCHAR(36) NULL AFTER seller_id,
      ADD INDEX idx_shop (shop_id),
      ADD FOREIGN KEY fk_auction_shop (shop_id) REFERENCES shops(id) ON DELETE SET NULL
    `);
    console.log('   ✓ Added shop_id to auctions table');

    // Add shop role to users
    await db.execute(`
      ALTER TABLE users 
      MODIFY COLUMN role ENUM('user', 'shop', 'admin') DEFAULT 'user'
    `);
    console.log('   ✓ Added shop role to users');
  },

  async down(db) {
    // Remove shop_id from auctions
    await db.execute(`ALTER TABLE auctions DROP FOREIGN KEY fk_auction_shop`);
    await db.execute(`ALTER TABLE auctions DROP INDEX idx_shop`);
    await db.execute(`ALTER TABLE auctions DROP COLUMN shop_id`);
    console.log('   ✓ Removed shop_id from auctions');

    // Revert user role
    await db.execute(`
      ALTER TABLE users 
      MODIFY COLUMN role ENUM('user', 'admin') DEFAULT 'user'
    `);
    console.log('   ✓ Reverted users role enum');

    // Drop shops table
    await db.execute(`DROP TABLE IF EXISTS shops`);
    console.log('   ✓ Dropped shops table');
  }
};
