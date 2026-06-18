const { getPool } = require('../services/databaseService');
const { parseImages } = require('../utils/images');

async function listOrders(req, res) {
  try {
    const pool = getPool();
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

    return res.render('order/list', {
      user: req.session.user,
      orders: normalizedOrders,
      success: req.query.success || null
    });
  } catch (err) {
    console.error(err);
    return res.render('order/list', {
      user: req.session.user,
      orders: [],
      success: null
    });
  }
}

module.exports = {
  listOrders
};
