const { getPool } = require('../services/databaseService');
const {
  softDeleteUser,
  restoreUser,
  permanentlyDeleteUser,
  softDeleteProduct,
  restoreProduct,
  permanentlyDeleteProduct,
  listRecycleBin
} = require('../services/recycleBinService');

async function dashboard(req, res) {
  try {
    const pool = getPool();
    const [userStats] = await pool.execute("SELECT COUNT(*) as count FROM users WHERE role = 'user' AND deleted_at IS NULL");
    const [productStats] = await pool.execute("SELECT COUNT(*) as count FROM products WHERE status = 'available'");
    const [orderStats] = await pool.execute("SELECT COUNT(*) as count FROM orders WHERE status = 'confirmed'");
    const [recycleStats] = await pool.execute(`
      SELECT
        (SELECT COUNT(*) FROM users WHERE role = 'user' AND deleted_at IS NOT NULL) AS userCount,
        (SELECT COUNT(*) FROM products WHERE status = 'deleted') AS productCount
    `);

    const stats = {
      userCount: userStats[0].count,
      productCount: productStats[0].count,
      orderCount: orderStats[0].count,
      recycleUserCount: recycleStats[0].userCount,
      recycleProductCount: recycleStats[0].productCount
    };

    return res.render('admin/index', { user: req.session.user, stats });
  } catch (err) {
    console.error(err);
    return res.render('admin/index', {
      user: req.session.user,
      stats: { userCount: 0, productCount: 0, orderCount: 0, recycleUserCount: 0, recycleProductCount: 0 }
    });
  }
}

async function listUsers(req, res) {
  try {
    const pool = getPool();
    const [users] = await pool.execute(
      "SELECT id, phone, nickname, role, created_at FROM users WHERE role = 'user' AND deleted_at IS NULL ORDER BY created_at DESC"
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
    const userId = Number(req.params.id);

    if (!Number.isInteger(userId) || userId <= 0) {
      return res.redirect(`/admin/users?error=${encodeURIComponent('用户ID无效')}`);
    }

    const result = await softDeleteUser(userId);
    if (!result.ok) {
      return res.redirect(`/admin/users?error=${encodeURIComponent('用户不存在或不可删除')}`);
    }

    return res.redirect(`/admin/users?success=${encodeURIComponent('用户已移入回收站，手机号可重新注册')}`);
  } catch (err) {
    console.error(err);
    return res.redirect(`/admin/users?error=${encodeURIComponent('删除用户失败，请稍后重试')}`);
  }
}

async function listProducts(req, res) {
  try {
    const pool = getPool();
    const [products] = await pool.execute(
      `SELECT products.*, users.nickname
       FROM products
       JOIN users ON products.user_id = users.id
       WHERE products.status <> 'deleted'
         AND users.deleted_at IS NULL
       ORDER BY products.created_at DESC`
    );

    return res.render('admin/products', {
      user: req.session.user,
      products,
      error: req.query.error || null,
      success: req.query.success || null
    });
  } catch (err) {
    console.error(err);
    return res.render('admin/products', {
      user: req.session.user,
      products: [],
      error: '商品列表加载失败',
      success: null
    });
  }
}

async function deleteProduct(req, res) {
  try {
    const productId = Number(req.params.id);

    if (!Number.isInteger(productId) || productId <= 0) {
      return res.redirect(`/admin/products?error=${encodeURIComponent('商品ID无效')}`);
    }

    const result = await softDeleteProduct(productId);
    if (!result.ok) {
      return res.redirect(`/admin/products?error=${encodeURIComponent('商品不存在或已在回收站')}`);
    }

    return res.redirect(`/admin/products?success=${encodeURIComponent('商品已移入回收站')}`);
  } catch (err) {
    console.error(err);
    return res.redirect('/admin/products');
  }
}

async function recycleBin(req, res) {
  try {
    const { users, products } = await listRecycleBin();

    return res.render('admin/recycle-bin', {
      user: req.session.user,
      deletedUsers: users,
      deletedProducts: products,
      error: req.query.error || null,
      success: req.query.success || null
    });
  } catch (err) {
    console.error(err);
    return res.render('admin/recycle-bin', {
      user: req.session.user,
      deletedUsers: [],
      deletedProducts: [],
      error: '回收站加载失败',
      success: null
    });
  }
}

async function restoreDeletedUser(req, res) {
  try {
    const userId = Number(req.params.id);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.redirect(`/admin/recycle-bin?error=${encodeURIComponent('用户ID无效')}`);
    }

    const result = await restoreUser(userId);
    if (result.ok) {
      return res.redirect(`/admin/recycle-bin?success=${encodeURIComponent('用户已恢复，可使用原手机号登录')}`);
    }

    const messageMap = {
      phone_conflict: '原手机号已被重新注册，请先处理冲突账号后再恢复',
      missing_phone: '该用户缺少原手机号记录，无法恢复',
      not_found: '用户不存在或不在回收站'
    };

    return res.redirect(`/admin/recycle-bin?error=${encodeURIComponent(messageMap[result.reason] || '用户恢复失败')}`);
  } catch (err) {
    console.error(err);
    return res.redirect(`/admin/recycle-bin?error=${encodeURIComponent('用户恢复失败，请稍后重试')}`);
  }
}

async function purgeDeletedUser(req, res) {
  try {
    const userId = Number(req.params.id);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.redirect(`/admin/recycle-bin?error=${encodeURIComponent('用户ID无效')}`);
    }

    const result = await permanentlyDeleteUser(userId);
    if (!result.ok) {
      return res.redirect(`/admin/recycle-bin?error=${encodeURIComponent('用户不存在或不在回收站')}`);
    }

    return res.redirect(`/admin/recycle-bin?success=${encodeURIComponent('用户已彻底删除，相关商品和订单已清理')}`);
  } catch (err) {
    console.error(err);
    return res.redirect(`/admin/recycle-bin?error=${encodeURIComponent('彻底删除用户失败，请稍后重试')}`);
  }
}

async function restoreDeletedProduct(req, res) {
  try {
    const productId = Number(req.params.id);
    if (!Number.isInteger(productId) || productId <= 0) {
      return res.redirect(`/admin/recycle-bin?error=${encodeURIComponent('商品ID无效')}`);
    }

    const result = await restoreProduct(productId);
    if (result.ok) {
      return res.redirect(`/admin/recycle-bin?success=${encodeURIComponent('商品已恢复')}`);
    }

    const messageMap = {
      owner_deleted: '卖家仍在用户回收站，请先恢复卖家后再恢复商品',
      not_found: '商品不存在或不在回收站'
    };

    return res.redirect(`/admin/recycle-bin?error=${encodeURIComponent(messageMap[result.reason] || '商品恢复失败')}`);
  } catch (err) {
    console.error(err);
    return res.redirect(`/admin/recycle-bin?error=${encodeURIComponent('商品恢复失败，请稍后重试')}`);
  }
}

async function purgeDeletedProduct(req, res) {
  try {
    const productId = Number(req.params.id);
    if (!Number.isInteger(productId) || productId <= 0) {
      return res.redirect(`/admin/recycle-bin?error=${encodeURIComponent('商品ID无效')}`);
    }

    const result = await permanentlyDeleteProduct(productId);
    if (!result.ok) {
      return res.redirect(`/admin/recycle-bin?error=${encodeURIComponent('商品不存在或不在回收站')}`);
    }

    return res.redirect(`/admin/recycle-bin?success=${encodeURIComponent('商品已彻底删除，相关订单已清理')}`);
  } catch (err) {
    console.error(err);
    return res.redirect(`/admin/recycle-bin?error=${encodeURIComponent('彻底删除商品失败，请稍后重试')}`);
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
  recycleBin,
  restoreDeletedUser,
  purgeDeletedUser,
  restoreDeletedProduct,
  purgeDeletedProduct,
  listOrders
};
