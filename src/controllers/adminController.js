const { getPool } = require('../services/databaseService');

async function dashboard(req, res) {
  try {
    const pool = getPool();
    const [userStats] = await pool.execute("SELECT COUNT(*) as count FROM users WHERE role = 'user'");
    const [productStats] = await pool.execute("SELECT COUNT(*) as count FROM products WHERE status = 'available'");
    const [orderStats] = await pool.execute("SELECT COUNT(*) as count FROM orders WHERE status = 'confirmed'");

    const stats = {
      userCount: userStats[0].count,
      productCount: productStats[0].count,
      orderCount: orderStats[0].count
    };

    return res.render('admin/index', { user: req.session.user, stats });
  } catch (err) {
    console.error(err);
    return res.render('admin/index', {
      user: req.session.user,
      stats: { userCount: 0, productCount: 0, orderCount: 0 }
    });
  }
}

async function listUsers(req, res) {
  try {
    const pool = getPool();
    const [users] = await pool.execute(
      "SELECT id, phone, nickname, role, created_at FROM users WHERE role = 'user' ORDER BY created_at DESC"
    );

    return res.render('admin/users', { user: req.session.user, users });
  } catch (err) {
    console.error(err);
    return res.render('admin/users', { user: req.session.user, users: [] });
  }
}

async function deleteUser(req, res) {
  try {
    const pool = getPool();
    await pool.execute('DELETE FROM users WHERE id = ? AND role = \'user\'', [req.params.id]);
    return res.redirect('/admin/users');
  } catch (err) {
    console.error(err);
    return res.redirect('/admin/users');
  }
}

async function listProducts(req, res) {
  try {
    const pool = getPool();
    const [products] = await pool.execute(
      'SELECT products.*, users.nickname FROM products JOIN users ON products.user_id = users.id ORDER BY products.created_at DESC'
    );

    return res.render('admin/products', { user: req.session.user, products });
  } catch (err) {
    console.error(err);
    return res.render('admin/products', { user: req.session.user, products: [] });
  }
}

async function deleteProduct(req, res) {
  try {
    const pool = getPool();
    await pool.execute("UPDATE products SET status = 'deleted' WHERE id = ?", [req.params.id]);
    return res.redirect('/admin/products');
  } catch (err) {
    console.error(err);
    return res.redirect('/admin/products');
  }
}

async function listOrders(req, res) {
  try {
    const pool = getPool();
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

    return res.render('admin/orders', { user: req.session.user, orders, stats });
  } catch (err) {
    console.error(err);
    return res.render('admin/orders', {
      user: req.session.user,
      orders: [],
      stats: { totalOrders: 0, totalAmount: 0, pendingOrders: 0 }
    });
  }
}

module.exports = {
  dashboard,
  listUsers,
  deleteUser,
  listProducts,
  deleteProduct,
  listOrders
};
