/**
 * Migration: fix_transactions_table
 * Created at: 2026-01-15
 * 
 * Makes balance_after nullable since it's not always provided
 */

module.exports = {
  async up(db) {
    // Check current structure
    const [cols] = await db.execute(`
      SELECT COLUMN_NAME, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'transactions' AND COLUMN_NAME = 'balance_after'
    `);

    if (cols.length > 0 && cols[0].IS_NULLABLE === 'NO') {
      await db.execute(`
        ALTER TABLE transactions 
        MODIFY COLUMN balance_after DECIMAL(15, 2) NULL DEFAULT NULL
      `);
      console.log('   ✓ Made balance_after nullable in transactions');
    } else {
      console.log('   ✓ balance_after already nullable or not found');
    }
  },

  async down(db) {
    await db.execute(`
      ALTER TABLE transactions 
      MODIFY COLUMN balance_after DECIMAL(15, 2) NOT NULL
    `);
    console.log('   ✓ Reverted balance_after to NOT NULL');
  }
};
