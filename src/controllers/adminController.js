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

    return res.render('admin/users', {
      user: req.session.user,
      users,
      error: req.query.error || null,
      success: req.query.success || null
    });
  } catch (err) {
    console.error(err);
    return res.render('admin/users', {
      user: req.session.user,
      users: [],
      error: '用户列表加载失败',
      success: null
    });
  }
}

async function deleteUser(req, res) {
  try {
    const pool = getPool();
    const userId = Number(req.params.id);

    if (!Number.isInteger(userId) || userId <= 0) {
      return res.redirect(`/admin/users?error=${encodeURIComponent('用户ID无效')}`);
    }

    const [[userRow]] = await pool.execute(
      "SELECT id FROM users WHERE id = ? AND role = 'user'",
      [userId]
    );

    if (!userRow) {
      return res.redirect(`/admin/users?error=${encodeURIComponent('用户不存在或不可删除')}`);
    }

    const [[productStats]] = await pool.execute(
      `SELECT COUNT(*) AS total
       FROM products
       WHERE user_id = ? AND status <> 'deleted'`,
      [userId]
    );

    if (productStats.total > 0) {
      return res.redirect(
        `/admin/users?error=${encodeURIComponent('该用户仍有关联商品，请先处理商品后再删除')}`
      );
    }

    const [[orderStats]] = await pool.execute(
      `SELECT COUNT(*) AS total
       FROM orders
       WHERE buyer_id = ? OR seller_id = ?`,
      [userId, userId]
    );

    if (orderStats.total > 0) {
      return res.redirect(
        `/admin/users?error=${encodeURIComponent('该用户仍有关联订单，请先处理订单后再删除')}`
      );
    }

    await pool.execute("DELETE FROM users WHERE id = ? AND role = 'user'", [userId]);
    return res.redirect(`/admin/users?success=${encodeURIComponent('用户删除成功')}`);
  } catch (err) {
    console.error(err);
    return res.redirect(`/admin/users?error=${encodeURIComponent('删除用户失败，请稍后重试')}`);
  }
}

async function listProducts(req, res) {
  try {
    const pool = getPool();
    const [products] = await pool.execute(
      'SELECT products.*, users.nickname FROM products JOIN users ON products.user_id = users.id ORDER BY products.created_at DESC'
    );

    return res.render('admin/products', {
      user: req.session.user,
      products,
      success: req.query.success || null
    });
  } catch (err) {
    console.error(err);
    return res.render('admin/products', {
      user: req.session.user,
      products: [],
      success: null
    });
  }
}

async function deleteProduct(req, res) {
  try {
    const pool = getPool();
    await pool.execute("UPDATE products SET status = 'deleted' WHERE id = ?", [req.params.id]);
    return res.redirect(`/admin/products?success=${encodeURIComponent('商品下架成功')}`);
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
