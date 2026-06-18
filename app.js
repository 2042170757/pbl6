require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const dbConfig = require('./src/config/database');
const sessionConfig = require('./src/config/session');

const app = express();
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

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
  await tempPool.execute("CREATE DATABASE IF NOT EXISTS pbl6 CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (buyer_id) REFERENCES users(id),
      FOREIGN KEY (seller_id) REFERENCES users(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `;
  await pool.execute(createOrdersTableSQL);

  const [admins] = await pool.execute("SELECT * FROM users WHERE phone = '17359050190'");
  if (admins.length === 0) {
    const hashedPassword = await bcrypt.hash('123456', 10);
    await pool.execute(
      "INSERT INTO users (phone, password, nickname, role) VALUES (?, ?, ?, ?)",
      ['17359050190', hashedPassword, '管理员', 'admin']
    );
  }
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
    if (!/^\d{1,11}$/.test(phone)) {
      return res.render('user/register', { error: '手机号必须是1-11位数字' });
    }
    if (!/^\d{1,11}$/.test(password)) {
      return res.render('user/register', { error: '密码必须是1-11位数字' });
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
  const rememberPhone = req.cookies ? req.cookies.rememberPhone : null;
  res.render('user/login', { error: null, phone: rememberPhone || '' });
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
    
    if (remember) {
      res.cookie('rememberPhone', phone, { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true });
    }
    
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
  res.clearCookie('rememberPhone');
  res.redirect('/login');
});

app.get('/products', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'user') {
    return res.redirect('/login');
  }

  try {
    const [products] = await pool.execute(
      "SELECT products.*, users.nickname FROM products JOIN users ON products.user_id = users.id WHERE products.status = 'available' ORDER BY products.created_at DESC"
    );
    res.render('product/list', { user: req.session.user, products });
  } catch (err) {
    console.error(err);
    res.render('product/list', { user: req.session.user, products: [] });
  }
});

app.get('/admin', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.redirect('/login');
  }

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

app.get('/admin/users', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.redirect('/login');
  }
  
  try {
    const [users] = await pool.execute("SELECT id, phone, nickname, role, created_at FROM users WHERE role = 'user' ORDER BY created_at DESC");
    res.render('admin/users', { user: req.session.user, users });
  } catch (err) {
    console.error(err);
    res.render('admin/users', { user: req.session.user, users: [] });
  }
});

app.post('/admin/users/delete/:id', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.redirect('/login');
  }

  try {
    await pool.execute("DELETE FROM users WHERE id = ? AND role = 'user'", [req.params.id]);
    res.redirect('/admin/users');
  } catch (err) {
    console.error(err);
    res.redirect('/admin/users');
  }
});

// Admin: Product Management
app.get('/admin/products', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.redirect('/login');
  }

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

app.post('/admin/products/delete/:id', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.redirect('/login');
  }

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
app.get('/admin/orders', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.redirect('/login');
  }

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
app.get('/products/publish', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'user') {
    return res.redirect('/login');
  }
  res.render('product/publish', { user: req.session.user, error: null });
});

// User: Handle Product Publish (with image upload)
app.post('/products/publish', upload.array('images', 6), async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'user') {
    return res.redirect('/login');
  }

  try {
    const { title, description, price } = req.body;

    // Server-side validation
    if (!title || !title.trim()) {
      return res.render('product/publish', { user: req.session.user, error: '请填写商品标题' });
    }
    if (!price || parseFloat(price) <= 0) {
      return res.render('product/publish', { user: req.session.user, error: '请填写有效的价格' });
    }
    if (!req.files || req.files.length === 0) {
      return res.render('product/publish', { user: req.session.user, error: '请至少上传1张商品图片' });
    }

    // Store image paths as JSON
    const imagePaths = req.files.map(f => '/uploads/' + f.filename);

    await pool.execute(
      "INSERT INTO products (user_id, title, description, price, images) VALUES (?, ?, ?, ?, ?)",
      [req.session.user.id, title.trim(), description ? description.trim() : '', price, JSON.stringify(imagePaths)]
    );

    res.redirect('/products');
  } catch (err) {
    console.error(err);
    res.render('product/publish', { user: req.session.user, error: '发布失败，请稍后重试' });
  }
});

const PORT = process.env.PORT || 3000;
// app.listen(PORT, () => {
//   console.log(`Server running on port ${PORT}`);
// });