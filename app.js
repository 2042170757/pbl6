require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const crypto = require('crypto');
const dbConfig = require('./src/config/database');
const sessionConfig = require('./src/config/session');

const app = express();
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const ADMIN_PHONE = (process.env.ADMIN_PHONE || '').trim();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const ADMIN_NICKNAME = (process.env.ADMIN_NICKNAME || '管理员').trim() || '管理员';

function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
}

function requireUser(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'user') {
    return res.redirect('/login');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.redirect('/login');
  }
  next();
}

function parseImages(images) {
  if (!images) return [];
  if (Array.isArray(images)) return images;
  try {
    const parsed = JSON.parse(images);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

function cleanupUploadedFiles(files = []) {
  files.forEach(file => {
    if (file && file.path && fs.existsSync(file.path)) {
      fs.unlink(file.path, () => {});
    }
  });
}

function ensureCsrfToken(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  res.locals.csrfToken = req.session.csrfToken;
  next();
}

function validateCsrf(req, res, next) {
  const token = req.body._csrf || req.get('x-csrf-token');
  if (!token || token !== req.session.csrfToken) {
    return res.status(403).send('表单已失效，请返回上一页重试');
  }
  next();
}

function validateUploadCsrf(req, res, next) {
  const token = req.body._csrf || req.get('x-csrf-token');
  if (!token || token !== req.session.csrfToken) {
    cleanupUploadedFiles(req.files);
    return res.status(403).send('表单已失效，请返回上一页重试');
  }
  next();
}

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
    "SELECT id FROM users WHERE phone = ?",
    [ADMIN_PHONE]
  );

  if (admins.length > 0) {
    return;
  }

  const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, 10);
  await pool.execute(
    "INSERT INTO users (phone, password, nickname, role) VALUES (?, ?, ?, ?)",
    [ADMIN_PHONE, hashedPassword, ADMIN_NICKNAME, 'admin']
  );
  console.log(`Admin account initialized for phone ${ADMIN_PHONE}`);
}

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'src/public/uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer config for multi-image upload
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, 'product-' + uniqueSuffix + ext);
  }
});
const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.match(/^image\/(jpeg|png|jpg)$/)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPG, PNG images are allowed'));
    }
  }
});

let pool;
async function initDB() {
  const tempConfig = { ...dbConfig, database: undefined };
  const tempPool = mysql.createPool(tempConfig);
  const databaseName = String(dbConfig.database).replace(/`/g, '``');
  await tempPool.execute(`CREATE DATABASE IF NOT EXISTS \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await tempPool.end();
  
  pool = mysql.createPool(dbConfig);
  const createTableSQL = `
    CREATE TABLE IF NOT EXISTS users (
      id INT PRIMARY KEY AUTO_INCREMENT,
      phone VARCHAR(11) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      nickname VARCHAR(50) DEFAULT '新用户',
      role ENUM('user', 'admin') DEFAULT 'user',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `;
  await pool.execute(createTableSQL);
  
  const createProductsTableSQL = `
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
  `;
  await pool.execute(createProductsTableSQL);

  // Add images column to products if not exists
  try {
    const [cols] = await pool.execute("SHOW COLUMNS FROM products LIKE 'images'");
    if (cols.length === 0) {
      await pool.execute("ALTER TABLE products ADD COLUMN images JSON");
    }
  } catch (e) {
    // Ignore errors
  }

  // Create orders table
  const createOrdersTableSQL = `
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
  `;
  await pool.execute(createOrdersTableSQL);

  await ensureColumn('orders', 'receiver_name', 'VARCHAR(50)');
  await ensureColumn('orders', 'receiver_phone', 'VARCHAR(20)');
  await ensureColumn('orders', 'receiver_address', 'VARCHAR(255)');
  await ensureColumn('orders', 'updated_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');

  await ensureAdminUser();
}
// Start server after DB init
initDB()
  .then(() => {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'src/views'));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'src/public')));
app.use(session(sessionConfig));
app.use(ensureCsrfToken);
app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS' || req.is('multipart/form-data')) {
    return next();
  }
  validateCsrf(req, res, next);
});

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

app.get('/', (req, res) => {
  if (req.session.user) {
    return req.session.user.role === 'admin' 
      ? res.redirect('/admin') 
      : res.redirect('/products');
  }
  res.redirect('/login');
});

app.get('/register', (req, res) => {
  res.render('user/register', { error: null });
});

app.post('/register', async (req, res) => {
  try {
    const { phone, password, confirmPassword } = req.body;
    
    if (!phone || !password || !confirmPassword) {
      return res.render('user/register', { error: '请填写所有字段' });
    }
    if (!/^\d{11}$/.test(phone)) {
      return res.render('user/register', { error: '手机号必须是11位数字' });
    }
    if (password.length < 6 || password.length > 18) {
      return res.render('user/register', { error: '密码长度需在6-18位之间' });
    }
    if (password !== confirmPassword) {
      return res.render('user/register', { error: '两次密码不一致' });
    }
    
    const [existing] = await pool.execute(
      "SELECT id FROM users WHERE phone = ?",
      [phone]
    );
    if (existing.length > 0) {
      return res.render('user/register', { error: '该手机号已注册，请登录' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.execute(
      "INSERT INTO users (phone, password, nickname, role) VALUES (?, ?, ?, ?)",
      [phone, hashedPassword, '新用户', 'user']
    );
    
    res.redirect('/login');
  } catch (err) {
    console.error(err);
    res.render('user/register', { error: '注册失败，请稍后重试' });
  }
});

app.get('/login', (req, res) => {
  res.render('user/login', { error: null, phone: '' });
});

app.post('/login', async (req, res) => {
  try {
    const { phone, password, remember } = req.body;
    
    if (!phone || !password) {
      return res.render('user/login', { error: '请填写手机号和密码', phone: '' });
    }
    
    const [users] = await pool.execute(
      "SELECT * FROM users WHERE phone = ?",
      [phone]
    );
    
    if (users.length === 0) {
      return res.render('user/login', { error: '手机号或密码错误', phone: '' });
    }
    
    const user = users[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.render('user/login', { error: '手机号或密码错误', phone: '' });
    }
    
    req.session.user = {
      id: user.id,
      phone: user.phone,
      nickname: user.nickname,
      role: user.role
    };
    
    if (user.role === 'admin') {
      return res.redirect('/admin');
    }
    res.redirect('/products');
  } catch (err) {
    console.error(err);
    res.render('user/login', { error: '登录失败，请稍后重试', phone: '' });
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

app.get('/products', requireLogin, async (req, res) => {
  try {
    const keyword = (req.query.q || '').trim();
    const sort = req.query.sort || 'latest';
    const sortMap = {
      latest: 'products.created_at DESC',
      price_asc: 'products.price ASC',
      price_desc: 'products.price DESC'
    };
    const orderBy = sortMap[sort] || sortMap.latest;
    const params = [];
    let where = "products.status = 'available'";

    if (keyword) {
      where += " AND (products.title LIKE ? OR products.description LIKE ? OR users.nickname LIKE ?)";
      const like = `%${keyword}%`;
      params.push(like, like, like);
    }

    const [products] = await pool.execute(
      `SELECT products.*, users.nickname
       FROM products
       JOIN users ON products.user_id = users.id
       WHERE ${where}
       ORDER BY ${orderBy}`,
      params
    );
    const normalizedProducts = products.map(product => ({
      ...product,
      productImages: parseImages(product.images)
    }));
    res.render('product/list', { user: req.session.user, products: normalizedProducts, query: { q: keyword, sort } });
  } catch (err) {
    console.error(err);
    res.render('product/list', { user: req.session.user, products: [], query: { q: '', sort: 'latest' } });
  }
});

app.get('/orders', requireUser, async (req, res) => {
  try {
    const [orders] = await pool.execute(`
      SELECT orders.*,
             products.title AS product_title,
             products.images AS product_images,
             buyer.nickname AS buyer_nickname,
             seller.nickname AS seller_nickname
      FROM orders
      JOIN products ON orders.product_id = products.id
      JOIN users AS buyer ON orders.buyer_id = buyer.id
      JOIN users AS seller ON orders.seller_id = seller.id
      WHERE orders.buyer_id = ? OR orders.seller_id = ?
      ORDER BY orders.created_at DESC
    `, [req.session.user.id, req.session.user.id]);

    const normalizedOrders = orders.map(order => ({
      ...order,
      productImages: parseImages(order.product_images),
      isBuyer: order.buyer_id === req.session.user.id
    }));

    res.render('order/list', { user: req.session.user, orders: normalizedOrders });
  } catch (err) {
    console.error(err);
    res.render('order/list', { user: req.session.user, orders: [] });
  }
});

app.get('/admin', requireAdmin, async (req, res) => {
  try {
    const [userStats] = await pool.execute("SELECT COUNT(*) as count FROM users WHERE role = 'user'");
    const [productStats] = await pool.execute("SELECT COUNT(*) as count FROM products WHERE status = 'available'");
    const [orderStats] = await pool.execute("SELECT COUNT(*) as count FROM orders WHERE status = 'confirmed'");

    const stats = {
      userCount: userStats[0].count,
      productCount: productStats[0].count,
      orderCount: orderStats[0].count
    };

    res.render('admin/index', { user: req.session.user, stats });
  } catch (err) {
    console.error(err);
    res.render('admin/index', { user: req.session.user, stats: { userCount: 0, productCount: 0, orderCount: 0 } });
  }
});

app.get('/admin/users', requireAdmin, async (req, res) => {
  try {
    const [users] = await pool.execute("SELECT id, phone, nickname, role, created_at FROM users WHERE role = 'user' ORDER BY created_at DESC");
    res.render('admin/users', { user: req.session.user, users });
  } catch (err) {
    console.error(err);
    res.render('admin/users', { user: req.session.user, users: [] });
  }
});

app.post('/admin/users/delete/:id', requireAdmin, async (req, res) => {
  try {
    await pool.execute("DELETE FROM users WHERE id = ? AND role = 'user'", [req.params.id]);
    res.redirect('/admin/users');
  } catch (err) {
    console.error(err);
    res.redirect('/admin/users');
  }
});

// Admin: Product Management
app.get('/admin/products', requireAdmin, async (req, res) => {
  try {
    const [products] = await pool.execute(
      "SELECT products.*, users.nickname FROM products JOIN users ON products.user_id = users.id ORDER BY products.created_at DESC"
    );
    res.render('admin/products', { user: req.session.user, products });
  } catch (err) {
    console.error(err);
    res.render('admin/products', { user: req.session.user, products: [] });
  }
});

app.post('/admin/products/delete/:id', requireAdmin, async (req, res) => {
  try {
    // Force delete (soft delete - mark as deleted)
    await pool.execute("UPDATE products SET status = 'deleted' WHERE id = ?", [req.params.id]);
    res.redirect('/admin/products');
  } catch (err) {
    console.error(err);
    res.redirect('/admin/products');
  }
});

// Admin: Order Management
app.get('/admin/orders', requireAdmin, async (req, res) => {
  try {
    const [orders] = await pool.execute(`
      SELECT orders.*,
             products.title as product_title,
             buyer.nickname as buyer_nickname,
             seller.nickname as seller_nickname
      FROM orders
      LEFT JOIN products ON orders.product_id = products.id
      LEFT JOIN users as buyer ON orders.buyer_id = buyer.id
      LEFT JOIN users as seller ON orders.seller_id = seller.id
      ORDER BY orders.created_at DESC
    `);

    const [statsResult] = await pool.execute(`
      SELECT
        COUNT(*) as totalOrders,
        COALESCE(SUM(CASE WHEN status = 'confirmed' THEN amount ELSE 0 END), 0) as totalAmount,
        COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) as pendingOrders
      FROM orders
    `);

    const stats = {
      totalOrders: statsResult[0].totalOrders || 0,
      totalAmount: statsResult[0].totalAmount || 0,
      pendingOrders: statsResult[0].pendingOrders || 0
    };

    res.render('admin/orders', { user: req.session.user, orders, stats });
  } catch (err) {
    console.error(err);
    res.render('admin/orders', { user: req.session.user, orders: [], stats: { totalOrders: 0, totalAmount: 0, pendingOrders: 0 } });
  }
});

// User: Product Publish Page
app.get('/products/publish', requireUser, (req, res) => {
  res.render('product/publish', { user: req.session.user, error: null });
});

// User: Handle Product Publish (with image upload)
app.post('/products/publish', requireUser, upload.array('images', 6), validateUploadCsrf, async (req, res) => {
  try {
    const { title, description, price } = req.body;
    const files = req.files || [];
    const priceValue = Number(price);

    // Server-side validation
    if (!title || !title.trim()) {
      cleanupUploadedFiles(files);
      return res.render('product/publish', { user: req.session.user, error: '请填写商品标题' });
    }
    if (title.trim().length > 100) {
      cleanupUploadedFiles(files);
      return res.render('product/publish', { user: req.session.user, error: '商品标题最多100个字符' });
    }
    if (description && description.trim().length > 500) {
      cleanupUploadedFiles(files);
      return res.render('product/publish', { user: req.session.user, error: '商品描述最多500个字符' });
    }
    if (!Number.isFinite(priceValue) || priceValue <= 0) {
      cleanupUploadedFiles(files);
      return res.render('product/publish', { user: req.session.user, error: '请填写有效的价格' });
    }
    if (files.length === 0) {
      return res.render('product/publish', { user: req.session.user, error: '请至少上传1张商品图片' });
    }

    // Store image paths as JSON
    const imagePaths = files.map(f => '/uploads/' + f.filename);

    await pool.execute(
      "INSERT INTO products (user_id, title, description, price, images) VALUES (?, ?, ?, ?, ?)",
      [req.session.user.id, title.trim(), description ? description.trim() : '', priceValue, JSON.stringify(imagePaths)]
    );

    res.redirect('/products');
  } catch (err) {
    console.error(err);
    res.render('product/publish', { user: req.session.user, error: '发布失败，请稍后重试' });
  }
});

app.get('/products/:id', requireLogin, async (req, res) => {
  try {
    const [products] = await pool.execute(
      `SELECT products.*, users.nickname, users.phone
       FROM products
       JOIN users ON products.user_id = users.id
       WHERE products.id = ? AND products.status <> 'deleted'`,
      [req.params.id]
    );

    if (products.length === 0) {
      return res.status(404).send('商品不存在或已下架');
    }

    const product = products[0];
    res.render('product/detail', {
      user: req.session.user,
      product,
      images: parseImages(product.images),
      error: req.query.error || null
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('商品详情加载失败');
  }
});

app.post('/products/:id/buy', requireUser, async (req, res) => {
  const productId = Number(req.params.id);
  const receiverName = (req.body.receiverName || '').trim();
  const receiverPhone = (req.body.receiverPhone || '').trim();
  const receiverAddress = (req.body.receiverAddress || '').trim();

  if (!Number.isInteger(productId) || productId <= 0) {
    return res.redirect('/products');
  }
  if (!receiverName || !receiverPhone || !receiverAddress) {
    return res.redirect(`/products/${productId}?error=${encodeURIComponent('请填写完整收货信息')}`);
  }
  if (!/^\d{11}$/.test(receiverPhone)) {
    return res.redirect(`/products/${productId}?error=${encodeURIComponent('收货手机号必须是11位数字')}`);
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [products] = await connection.execute(
      "SELECT * FROM products WHERE id = ? FOR UPDATE",
      [productId]
    );

    if (products.length === 0 || products[0].status !== 'available') {
      await connection.rollback();
      return res.redirect(`/products/${productId}?error=${encodeURIComponent('商品已售出或已下架')}`);
    }

    const product = products[0];
    if (product.user_id === req.session.user.id) {
      await connection.rollback();
      return res.redirect(`/products/${productId}?error=${encodeURIComponent('不能购买自己发布的商品')}`);
    }

    await connection.execute(
      `INSERT INTO orders
       (product_id, buyer_id, seller_id, amount, status, receiver_name, receiver_phone, receiver_address)
       VALUES (?, ?, ?, ?, 'confirmed', ?, ?, ?)`,
      [product.id, req.session.user.id, product.user_id, product.price, receiverName, receiverPhone, receiverAddress]
    );
    await connection.execute(
      "UPDATE products SET status = 'sold' WHERE id = ?",
      [product.id]
    );

    await connection.commit();
    res.redirect('/orders');
  } catch (err) {
    await connection.rollback();
    console.error(err);
    res.redirect(`/products/${productId}?error=${encodeURIComponent('购买失败，请稍后重试')}`);
  } finally {
    connection.release();
  }
});

const PORT = process.env.PORT || 3000;
// app.listen(PORT, () => {
//   console.log(`Server running on port ${PORT}`);
// });
