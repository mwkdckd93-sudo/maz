/**
 * Migration: add_missing_user_fields
 * Created at: 2026-01-15
 * 
 * Adds any missing fields used in user.routes.js
 */

module.exports = {
  async up(db) {
    // Check if product_count exists
    const [cols] = await db.execute(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
    `);
    const columnNames = cols.map(c => c.COLUMN_NAME);

    // Add bio column
    if (!columnNames.includes('bio')) {
      await db.execute(`ALTER TABLE users ADD COLUMN bio TEXT AFTER avatar_url`);
      console.log('   ✓ Added bio column to users');
    }

    // Add location column
    if (!columnNames.includes('location')) {
      await db.execute(`ALTER TABLE users ADD COLUMN location VARCHAR(100) AFTER bio`);
      console.log('   ✓ Added location column to users');
    }

    // Add last_seen column
    if (!columnNames.includes('last_seen')) {
      await db.execute(`ALTER TABLE users ADD COLUMN last_seen TIMESTAMP NULL AFTER updated_at`);
      console.log('   ✓ Added last_seen column to users');
    }

    // Add product_count for verified shops
    if (!columnNames.includes('product_count')) {
      await db.execute(`ALTER TABLE users ADD COLUMN product_count INT DEFAULT 0 AFTER total_bids`);
      console.log('   ✓ Added product_count column to users');
    }

    console.log('   ✓ All missing user fields checked/added');
  },

  async down(db) {
    await db.execute(`ALTER TABLE users DROP COLUMN IF EXISTS bio`);
    await db.execute(`ALTER TABLE users DROP COLUMN IF EXISTS location`);
    await db.execute(`ALTER TABLE users DROP COLUMN IF EXISTS last_seen`);
    await db.execute(`ALTER TABLE users DROP COLUMN IF EXISTS product_count`);
    console.log('   ✓ Removed added user fields');
  }
};
