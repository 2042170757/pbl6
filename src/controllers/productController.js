const { getPool } = require('../services/databaseService');
const { cleanupUploadedFiles } = require('../middlewares/upload');
const { parseImages } = require('../utils/images');

async function listProducts(req, res) {
  try {
    const pool = getPool();
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

    return res.render('product/list', {
      user: req.session.user,
      products: normalizedProducts,
      query: { q: keyword, sort }
    });
  } catch (err) {
    console.error(err);
    return res.render('product/list', {
      user: req.session.user,
      products: [],
      query: { q: '', sort: 'latest' }
    });
  }
}

function showPublishForm(req, res) {
  res.render('product/publish', { user: req.session.user, error: null });
}

async function publishProduct(req, res) {
  try {
    const pool = getPool();
    const { title, description, price } = req.body;
    const files = req.files || [];
    const priceValue = Number(price);

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

    const imagePaths = files.map(file => '/uploads/' + file.filename);

    await pool.execute(
      'INSERT INTO products (user_id, title, description, price, images) VALUES (?, ?, ?, ?, ?)',
      [req.session.user.id, title.trim(), description ? description.trim() : '', priceValue, JSON.stringify(imagePaths)]
    );

    return res.redirect('/products');
  } catch (err) {
    console.error(err);
    return res.render('product/publish', { user: req.session.user, error: '发布失败，请稍后重试' });
  }
}

async function showProductDetail(req, res) {
  try {
    const pool = getPool();
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
    return res.render('product/detail', {
      user: req.session.user,
      product,
      images: parseImages(product.images),
      error: req.query.error || null
    });
  } catch (err) {
    console.error(err);
    return res.status(500).send('商品详情加载失败');
  }
}

async function buyProduct(req, res) {
  const pool = getPool();
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
      'SELECT * FROM products WHERE id = ? FOR UPDATE',
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
    return res.redirect('/orders');
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.redirect(`/products/${productId}?error=${encodeURIComponent('购买失败，请稍后重试')}`);
  } finally {
    connection.release();
  }
}

module.exports = {
  listProducts,
  showPublishForm,
  publishProduct,
  showProductDetail,
  buyProduct
};
