/**
 * Migration: seed_default_data
 * Created at: 2026-01-15
 * 
 * Seeds the database with default categories and admin user
 */

const bcrypt = require('bcryptjs');

module.exports = {
  async up(db) {
    // Insert default categories
    await db.execute(`
      INSERT IGNORE INTO categories (id, name, name_ar, icon, color, sort_order) VALUES
      ('cat-1', 'electronics', 'إلكترونيات', 'devices', '#2196F3', 1),
      ('cat-2', 'mobiles', 'موبايلات', 'smartphone', '#9C27B0', 2),
      ('cat-3', 'home_appliances', 'أجهزة منزلية', 'kitchen', '#FF9800', 3),
      ('cat-4', 'gaming', 'كيمينك', 'sports_esports', '#F44336', 4),
      ('cat-5', 'furniture', 'أثاث', 'chair', '#795548', 5),
      ('cat-6', 'watches', 'ساعات', 'watch', '#009688', 6),
      ('cat-7', 'cameras', 'كاميرات', 'camera_alt', '#607D8B', 7)
    `);
    console.log('   ✓ Inserted default categories');

    // Insert default admin user
    const passwordHash = await bcrypt.hash('Admin@123', 10);
    
    await db.execute(`
      INSERT IGNORE INTO users (id, full_name, phone, email, password_hash, role, is_verified, is_active)
      VALUES ('admin-001', 'مدير النظام', '07700000000', 'admin@mazad.com', ?, 'admin', TRUE, TRUE)
    `, [passwordHash]);
    console.log('   ✓ Inserted default admin user');
    console.log('     Email: admin@mazad.com');
    console.log('     Password: Admin@123');
  },

  async down(db) {
    // Remove seeded data
    await db.execute(`DELETE FROM users WHERE id = 'admin-001'`);
    console.log('   ✓ Removed admin user');

    await db.execute(`DELETE FROM categories WHERE id LIKE 'cat-%'`);
    console.log('   ✓ Removed default categories');
  }
};
