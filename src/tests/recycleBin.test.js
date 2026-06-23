const assert = require('assert');
const bcrypt = require('bcryptjs');
const { initDatabase, getPool } = require('../services/databaseService');
const { login } = require('../controllers/authController');
const {
  softDeleteUser,
  restoreUser,
  permanentlyDeleteUser,
  softDeleteProduct,
  restoreProduct,
  permanentlyDeleteProduct,
  listRecycleBin
} = require('../services/recycleBinService');

async function createUser(connection, phone, nickname = '测试用户') {
  const password = await bcrypt.hash('123456', 4);
  const [result] = await connection.execute(
    `INSERT INTO users (phone, password, nickname, campus, bio, profile_completed, role)
     VALUES (?, ?, ?, '测试校区', '', 1, 'user')`,
    [phone, password, nickname]
  );
  return result.insertId;
}

async function createProduct(connection, userId, title = '测试商品') {
  const [result] = await connection.execute(
    `INSERT INTO products (user_id, title, description, price, images, status)
     VALUES (?, ?, '回收站测试商品', 9.90, JSON_ARRAY('/uploads/test.jpg'), 'available')`,
    [userId, title]
  );
  return result.insertId;
}

async function createOrder(connection, productId, buyerId, sellerId) {
  const [result] = await connection.execute(
    `INSERT INTO orders (product_id, buyer_id, seller_id, amount, status, receiver_name, receiver_phone, receiver_address)
     VALUES (?, ?, ?, 9.90, 'confirmed', '测试收货人', '13800000000', '测试地址')`,
    [productId, buyerId, sellerId]
  );
  return result.insertId;
}

async function cleanup(connection) {
  await connection.execute("DELETE FROM orders WHERE receiver_address = '测试地址'");
  await connection.execute("DELETE FROM products WHERE title LIKE '回收站测试%' OR description = '回收站测试商品'");
  await connection.execute("DELETE FROM users WHERE phone IN ('13900000001','13900000002','13900000003','13900000004') OR deleted_phone IN ('13900000001','13900000002','13900000003','13900000004')");
}

async function assertCanLogin(phone, password) {
  const req = {
    body: { phone, password },
    ip: '127.0.0.1',
    headers: {},
    session: {}
  };
  const res = {
    redirectedTo: null,
    rendered: null,
    redirect(target) {
      this.redirectedTo = target;
      return target;
    },
    render(view, model) {
      this.rendered = { view, model };
      return this.rendered;
    },
    status() {
      return this;
    }
  };

  await login(req, res);
  assert.strictEqual(res.redirectedTo, '/products');
  assert.strictEqual(req.session.user.phone, phone);
  assert.strictEqual(req.session.user.role, 'user');
}

async function run() {
  process.env.DB_PASSWORD = process.env.DB_PASSWORD || '123456';
  process.env.ADMIN_PHONE = process.env.ADMIN_PHONE || '17359050190';
  process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '123456';

  await initDatabase();
  const pool = getPool();
  const connection = await pool.getConnection();

  try {
    await cleanup(connection);

    const sellerId = await createUser(connection, '13900000001', '回收站卖家');
    const buyerId = await createUser(connection, '13900000002', '回收站买家');
    const productId = await createProduct(connection, sellerId, '回收站测试商品-用户删除');
    const orderId = await createOrder(connection, productId, buyerId, sellerId);

    assert.deepStrictEqual(await softDeleteUser(sellerId), { ok: true });

    const [[deletedSeller]] = await connection.execute(
      'SELECT phone, deleted_phone, deleted_at FROM users WHERE id = ?',
      [sellerId]
    );
    assert.strictEqual(deletedSeller.deleted_phone, '13900000001');
    assert.notStrictEqual(deletedSeller.phone, '13900000001');
    assert.ok(deletedSeller.deleted_at);

    const [[deletedProduct]] = await connection.execute(
      'SELECT status, deleted_at FROM products WHERE id = ?',
      [productId]
    );
    assert.strictEqual(deletedProduct.status, 'deleted');
    assert.ok(deletedProduct.deleted_at);

    const reusedUserId = await createUser(connection, '13900000001', '复用手机号用户');
    assert.deepStrictEqual(await restoreUser(sellerId), { ok: false, reason: 'phone_conflict' });

    const [recycleState] = await Promise.all([listRecycleBin()]);
    assert.ok(recycleState.users.some(user => user.id === sellerId));
    assert.ok(recycleState.products.some(product => product.id === productId));

    const [[orderBeforePurge]] = await connection.execute('SELECT id FROM orders WHERE id = ?', [orderId]);
    assert.ok(orderBeforePurge);

    assert.deepStrictEqual(await permanentlyDeleteUser(sellerId), { ok: true });

    const [[sellerAfterPurge]] = await connection.execute('SELECT id FROM users WHERE id = ?', [sellerId]);
    const [[productAfterPurge]] = await connection.execute('SELECT id FROM products WHERE id = ?', [productId]);
    const [[orderAfterPurge]] = await connection.execute('SELECT id FROM orders WHERE id = ?', [orderId]);
    assert.strictEqual(sellerAfterPurge, undefined);
    assert.strictEqual(productAfterPurge, undefined);
    assert.strictEqual(orderAfterPurge, undefined);

    const restoreLoginUserId = await createUser(connection, '13900000004', '恢复登录用户');
    assert.deepStrictEqual(await softDeleteUser(restoreLoginUserId), { ok: true });

    const [[loginUserWhileDeleted]] = await connection.execute(
      'SELECT id FROM users WHERE phone = ? AND deleted_at IS NULL',
      ['13900000004']
    );
    assert.strictEqual(loginUserWhileDeleted, undefined);

    assert.deepStrictEqual(await restoreUser(restoreLoginUserId), { ok: true });
    await assertCanLogin('13900000004', '123456');

    const productOwnerId = await createUser(connection, '13900000003', '商品恢复卖家');
    const productOnlyId = await createProduct(connection, productOwnerId, '回收站测试商品-单独删除');

    assert.deepStrictEqual(await softDeleteProduct(productOnlyId), { ok: true });
    assert.deepStrictEqual(await restoreProduct(productOnlyId), { ok: true });

    const [[restoredProduct]] = await connection.execute(
      'SELECT status, deleted_at FROM products WHERE id = ?',
      [productOnlyId]
    );
    assert.strictEqual(restoredProduct.status, 'available');
    assert.strictEqual(restoredProduct.deleted_at, null);

    assert.deepStrictEqual(await softDeleteProduct(productOnlyId), { ok: true });
    assert.deepStrictEqual(await permanentlyDeleteProduct(productOnlyId), { ok: true });

    const [[productAfterPermanentDelete]] = await connection.execute('SELECT id FROM products WHERE id = ?', [productOnlyId]);
    assert.strictEqual(productAfterPermanentDelete, undefined);

    await connection.execute('DELETE FROM users WHERE id IN (?, ?, ?, ?)', [buyerId, reusedUserId, productOwnerId, restoreLoginUserId]);

    console.log('recycle bin tests passed');
  } finally {
    await cleanup(connection);
    connection.release();
  }
}

run()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
