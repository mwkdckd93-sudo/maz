/**
 * Migration: add_payment_methods
 * Created at: 2026-01-15
 * 
 * Adds payment methods and orders system
 */

module.exports = {
  async up(db) {
    // Create payment_methods table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS payment_methods (
        id VARCHAR(36) PRIMARY KEY,
        name VARCHAR(50) NOT NULL,
        name_ar VARCHAR(50) NOT NULL,
        type ENUM('cash', 'card', 'wallet', 'bank_transfer', 'zaincash', 'fastpay') NOT NULL,
        icon VARCHAR(100),
        is_active BOOLEAN DEFAULT TRUE,
        sort_order INT DEFAULT 0,
        config JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('   ✓ Created payment_methods table');

    // Create orders table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS orders (
        id VARCHAR(36) PRIMARY KEY,
        order_number VARCHAR(20) UNIQUE NOT NULL,
        auction_id VARCHAR(36) NOT NULL,
        buyer_id VARCHAR(36) NOT NULL,
        seller_id VARCHAR(36) NOT NULL,
        shop_id VARCHAR(36),
        amount DECIMAL(15, 2) NOT NULL,
        commission DECIMAL(15, 2) DEFAULT 0,
        total_amount DECIMAL(15, 2) NOT NULL,
        payment_method_id VARCHAR(36),
        payment_status ENUM('pending', 'paid', 'failed', 'refunded') DEFAULT 'pending',
        order_status ENUM('pending', 'confirmed', 'shipping', 'delivered', 'cancelled', 'disputed') DEFAULT 'pending',
        shipping_address_id VARCHAR(36),
        tracking_number VARCHAR(100),
        notes TEXT,
        paid_at TIMESTAMP NULL,
        shipped_at TIMESTAMP NULL,
        delivered_at TIMESTAMP NULL,
        cancelled_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (auction_id) REFERENCES auctions(id),
        FOREIGN KEY (buyer_id) REFERENCES users(id),
        FOREIGN KEY (seller_id) REFERENCES users(id),
        FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE SET NULL,
        FOREIGN KEY (payment_method_id) REFERENCES payment_methods(id),
        FOREIGN KEY (shipping_address_id) REFERENCES addresses(id),
        INDEX idx_buyer (buyer_id),
        INDEX idx_seller (seller_id),
        INDEX idx_status (order_status),
        INDEX idx_created (created_at DESC)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('   ✓ Created orders table');

    // Insert default payment methods
    await db.execute(`
      INSERT IGNORE INTO payment_methods (id, name, name_ar, type, icon, sort_order) VALUES
      ('pm-1', 'Cash on Delivery', 'الدفع عند الاستلام', 'cash', 'payments', 1),
      ('pm-2', 'ZainCash', 'زين كاش', 'zaincash', 'account_balance_wallet', 2),
      ('pm-3', 'FastPay', 'فاست باي', 'fastpay', 'flash_on', 3),
      ('pm-4', 'Wallet Balance', 'رصيد المحفظة', 'wallet', 'wallet', 4)
    `);
    console.log('   ✓ Inserted default payment methods');
  },

  async down(db) {
    await db.execute(`DROP TABLE IF EXISTS orders`);
    console.log('   ✓ Dropped orders table');

    await db.execute(`DROP TABLE IF EXISTS payment_methods`);
    console.log('   ✓ Dropped payment_methods table');
  }
};
