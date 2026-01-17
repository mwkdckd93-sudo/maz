/**
 * Migration: add_company_auction_column
 * Created at: 2026-01-15
 * 
 * Adds is_company_auction column to auctions table
 */

module.exports = {
  async up(db) {
    await db.execute(`
      ALTER TABLE auctions 
      ADD COLUMN is_company_auction BOOLEAN DEFAULT FALSE AFTER is_featured
    `);
    console.log('   ✓ Added is_company_auction column to auctions');
  },

  async down(db) {
    await db.execute(`
      ALTER TABLE auctions DROP COLUMN is_company_auction
    `);
    console.log('   ✓ Removed is_company_auction column from auctions');
  }
};
