/**
 * Migration: Add bio field to users table
 * Date: 2026-01-16
 * Description: Adds bio (biography/description) field to users table for profile information
 */

async function up(db) {
  console.log('🔄 Running migration: Add bio field to users table...');

  try {
    // Check if bio column already exists
    const [columns] = await db.execute(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = 'users' AND COLUMN_NAME = 'bio'
    `);

    if (columns.length === 0) {
      // Add bio column after avatar_url
      await db.execute(`
        ALTER TABLE users 
        ADD COLUMN bio TEXT AFTER avatar_url
      `);
      console.log('   ✓ Added bio column to users table');
    } else {
      console.log('   ⏭ bio column already exists, skipping...');
    }

    console.log('✅ Migration completed successfully!');
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    throw error;
  }
}

async function down(db) {
  console.log('🔄 Rolling back migration: Remove bio field from users table...');

  try {
    await db.execute(`
      ALTER TABLE users 
      DROP COLUMN IF EXISTS bio
    `);
    console.log('   ✓ Removed bio column from users table');
    console.log('✅ Rollback completed successfully!');
  } catch (error) {
    console.error('❌ Rollback failed:', error.message);
    throw error;
  }
}

module.exports = { up, down };
