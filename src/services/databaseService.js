const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const dbConfig = require('../config/database');

const ADMIN_PHONE = (process.env.ADMIN_PHONE || '').trim();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const ADMIN_NICKNAME = (process.env.ADMIN_NICKNAME || '管理员').trim() || '管理员';

let pool;

async function ensureColumn(table, column, definition) {
  const [rows] = await pool.execute(
    `SELECT COUNT(*) AS count
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?`,
    [table, column]
  );

  if (rows[0].count === 0) {
    await pool.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

async function ensureAdminUser() {
  if (!ADMIN_PHONE || !ADMIN_PASSWORD) {
    console.warn('Admin bootstrap skipped: ADMIN_PHONE or ADMIN_PASSWORD is not configured.');
    return;
  }

  const [admins] = await pool.execute(
    'SELECT id FROM users WHERE phone = ?',
    [ADMIN_PHONE]
  );

  if (admins.length > 0) {
    return;
  }

  const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, 10);
  await pool.execute(
    'INSERT INTO users (phone, password, nickname, role) VALUES (?, ?, ?, ?)',
    [ADMIN_PHONE, hashedPassword, ADMIN_NICKNAME, 'admin']
  );
  console.log(`Admin account initialized for phone ${ADMIN_PHONE}`);
}

async function initDatabase() {
  const tempConfig = { ...dbConfig, database: undefined };
  const tempPool = mysql.createPool(tempConfig);
  const databaseName = String(dbConfig.database).replace(/`/g, '``');

  await tempPool.execute(
    `CREATE DATABASE IF NOT EXISTS \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await tempPool.end();

  pool = mysql.createPool(dbConfig);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INT PRIMARY KEY AUTO_INCREMENT,
      phone VARCHAR(11) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      nickname VARCHAR(50) DEFAULT '新用户',
      role ENUM('user', 'admin') DEFAULT 'user',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS products (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL,
      title VARCHAR(100) NOT NULL,
      description TEXT,
      price DECIMAL(10, 2) NOT NULL,
      status ENUM('available', 'sold', 'deleted') DEFAULT 'available',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  try {
    const [cols] = await pool.execute("SHOW COLUMNS FROM products LIKE 'images'");
    if (cols.length === 0) {
      await pool.execute('ALTER TABLE products ADD COLUMN images JSON');
    }
  } catch (err) {
    // Keep startup behavior unchanged for existing environments.
  }

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS orders (
      id INT PRIMARY KEY AUTO_INCREMENT,
      product_id INT NOT NULL,
      buyer_id INT NOT NULL,
      seller_id INT NOT NULL,
      amount DECIMAL(10,2) NOT NULL,
      status ENUM('pending','confirmed','cancelled','refunded') DEFAULT 'pending',
      receiver_name VARCHAR(50),
      receiver_phone VARCHAR(20),
      receiver_address VARCHAR(255),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (buyer_id) REFERENCES users(id),
      FOREIGN KEY (seller_id) REFERENCES users(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await ensureColumn('orders', 'receiver_name', 'VARCHAR(50)');
  await ensureColumn('orders', 'receiver_phone', 'VARCHAR(20)');
  await ensureColumn('orders', 'receiver_address', 'VARCHAR(255)');
  await ensureColumn('orders', 'updated_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');
  await ensureAdminUser();
}

function getPool() {
  if (!pool) {
    throw new Error('Database pool has not been initialized');
  }

  return pool;
}

module.exports = {
  initDatabase,
  getPool
};
