/**
 * Database Migration System
 * Handles schema versioning and migrations
 */

const db = require('../config/database');
const fs = require('fs');
const path = require('path');

class MigrationRunner {
  constructor() {
    this.migrationsPath = path.join(__dirname, 'scripts');
  }

  /**
   * Initialize migrations table
   */
  async init() {
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS migrations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        batch INT NOT NULL,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `;
    
    await db.execute(createTableSQL);
    console.log('✅ Migrations table ready');
  }

  /**
   * Get all migration files
   */
  getMigrationFiles() {
    if (!fs.existsSync(this.migrationsPath)) {
      fs.mkdirSync(this.migrationsPath, { recursive: true });
      return [];
    }

    return fs.readdirSync(this.migrationsPath)
      .filter(file => file.endsWith('.js'))
      .sort();
  }

  /**
   * Get executed migrations
   */
  async getExecutedMigrations() {
    try {
      const [rows] = await db.execute('SELECT name FROM migrations ORDER BY id');
      return rows.map(row => row.name);
    } catch (error) {
      return [];
    }
  }

  /**
   * Get current batch number
   */
  async getCurrentBatch() {
    try {
      const [rows] = await db.execute('SELECT MAX(batch) as batch FROM migrations');
      return (rows[0].batch || 0);
    } catch (error) {
      return 0;
    }
  }

  /**
   * Run pending migrations
   */
  async migrate() {
    await this.init();

    const files = this.getMigrationFiles();
    const executed = await this.getExecutedMigrations();
    const pending = files.filter(file => !executed.includes(file));

    if (pending.length === 0) {
      console.log('✅ Nothing to migrate. Database is up to date.');
      return;
    }

    const batch = await this.getCurrentBatch() + 1;
    console.log(`📦 Running ${pending.length} migration(s) in batch ${batch}...\n`);

    for (const file of pending) {
      const migration = require(path.join(this.migrationsPath, file));
      
      console.log(`⏳ Migrating: ${file}`);
      
      try {
        await migration.up(db);
        await db.execute('INSERT INTO migrations (name, batch) VALUES (?, ?)', [file, batch]);
        console.log(`✅ Migrated: ${file}\n`);
      } catch (error) {
        console.error(`❌ Error in migration ${file}:`, error.message);
        throw error;
      }
    }

    console.log(`\n✅ All migrations completed successfully!`);
  }

  /**
   * Rollback last batch of migrations
   */
  async rollback() {
    await this.init();

    const currentBatch = await this.getCurrentBatch();
    
    if (currentBatch === 0) {
      console.log('✅ Nothing to rollback.');
      return;
    }

    const [migrations] = await db.execute(
      'SELECT name FROM migrations WHERE batch = ? ORDER BY id DESC',
      [currentBatch]
    );

    if (migrations.length === 0) {
      console.log('✅ Nothing to rollback.');
      return;
    }

    console.log(`🔄 Rolling back batch ${currentBatch} (${migrations.length} migration(s))...\n`);

    for (const { name } of migrations) {
      const migrationPath = path.join(this.migrationsPath, name);
      
      if (!fs.existsSync(migrationPath)) {
        console.warn(`⚠️ Migration file not found: ${name}`);
        continue;
      }

      const migration = require(migrationPath);
      
      console.log(`⏳ Rolling back: ${name}`);
      
      try {
        await migration.down(db);
        await db.execute('DELETE FROM migrations WHERE name = ?', [name]);
        console.log(`✅ Rolled back: ${name}\n`);
      } catch (error) {
        console.error(`❌ Error rolling back ${name}:`, error.message);
        throw error;
      }
    }

    console.log(`\n✅ Rollback completed!`);
  }

  /**
   * Reset all migrations (rollback all, then migrate fresh)
   */
  async reset() {
    console.log('🔄 Resetting database...\n');
    
    let batch = await this.getCurrentBatch();
    while (batch > 0) {
      await this.rollback();
      batch = await this.getCurrentBatch();
    }
    
    console.log('\n📦 Re-running all migrations...\n');
    await this.migrate();
  }

  /**
   * Show migration status
   */
  async status() {
    await this.init();

    const files = this.getMigrationFiles();
    const executed = await this.getExecutedMigrations();

    console.log('\n📋 Migration Status:\n');
    console.log('┌─────────────────────────────────────────────────────────────┬──────────┐');
    console.log('│ Migration                                                   │ Status   │');
    console.log('├─────────────────────────────────────────────────────────────┼──────────┤');

    for (const file of files) {
      const status = executed.includes(file) ? '✅ Ran' : '⏳ Pending';
      const paddedFile = file.padEnd(61);
      const paddedStatus = status.padEnd(8);
      console.log(`│ ${paddedFile}│ ${paddedStatus}│`);
    }

    console.log('└─────────────────────────────────────────────────────────────┴──────────┘\n');
  }

  /**
   * Create a new migration file
   */
  create(name) {
    if (!fs.existsSync(this.migrationsPath)) {
      fs.mkdirSync(this.migrationsPath, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const filename = `${timestamp}_${name}.js`;
    const filepath = path.join(this.migrationsPath, filename);

    const template = `/**
 * Migration: ${name}
 * Created at: ${new Date().toISOString()}
 */

module.exports = {
  /**
   * Run the migration
   * @param {import('mysql2/promise').Pool} db - Database connection
   */
  async up(db) {
    // Write your migration SQL here
    // Example:
    // await db.execute(\`
    //   ALTER TABLE users ADD COLUMN new_field VARCHAR(100)
    // \`);
  },

  /**
   * Reverse the migration
   * @param {import('mysql2/promise').Pool} db - Database connection
   */
  async down(db) {
    // Write the rollback SQL here
    // Example:
    // await db.execute(\`
    //   ALTER TABLE users DROP COLUMN new_field
    // \`);
  }
};
`;

    fs.writeFileSync(filepath, template);
    console.log(`✅ Created migration: ${filename}`);
    console.log(`   Path: ${filepath}`);
  }
}

// CLI Handler
async function main() {
  const runner = new MigrationRunner();
  const command = process.argv[2];
  const arg = process.argv[3];

  try {
    switch (command) {
      case 'migrate':
      case 'up':
        await runner.migrate();
        break;

      case 'rollback':
      case 'down':
        await runner.rollback();
        break;

      case 'reset':
        await runner.reset();
        break;

      case 'status':
        await runner.status();
        break;

      case 'create':
        if (!arg) {
          console.error('❌ Please provide a migration name');
          console.log('   Usage: node migrate.js create <migration_name>');
          process.exit(1);
        }
        runner.create(arg);
        break;

      default:
        console.log(`
📦 Mazad Migration Tool

Usage:
  node migrate.js <command> [options]

Commands:
  migrate, up     Run all pending migrations
  rollback, down  Rollback the last batch of migrations
  reset           Rollback all migrations and re-run them
  status          Show the status of all migrations
  create <name>   Create a new migration file

Examples:
  node migrate.js migrate
  node migrate.js rollback
  node migrate.js create add_user_profile_fields
        `);
    }
  } catch (error) {
    console.error('❌ Migration error:', error.message);
    process.exit(1);
  }

  process.exit(0);
}

module.exports = MigrationRunner;

// Run if called directly
if (require.main === module) {
  main();
}
