const mysql = require('mysql2/promise');

// SECURITY: Validate database credentials
if (!process.env.DB_PASSWORD && process.env.NODE_ENV === 'production') {
  console.error('❌ FATAL: DB_PASSWORD must be set in production!');
  process.exit(1);
}

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'mazad_user',
  password: process.env.DB_PASSWORD || (process.env.NODE_ENV !== 'production' ? 'mazad_pass_2026' : ''),
  database: process.env.DB_NAME || 'mazad_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
});

// Test connection
pool.getConnection()
  .then(connection => {
    console.log('✅ Database connected successfully');
    connection.release();
  })
  .catch(err => {
    console.error('❌ Database connection failed:', err.message);
  });

module.exports = pool;
