const { getPool } = require('./databaseService');

function buildDeletedPhone(userId, originalPhone) {
  return `D${Number(userId).toString(36).padStart(10, '0').slice(-10)}`;
}

async function softDeleteUser(userId) {
  const pool = getPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [[user]] = await connection.execute(
      "SELECT id, phone, role, deleted_at FROM users WHERE id = ? FOR UPDATE",
      [userId]
    );

    if (!user || user.role !== 'user') {
      await connection.rollback();
      return { ok: false, reason: 'not_found' };
    }

    if (user.deleted_at) {
      await connection.rollback();
      return { ok: false, reason: 'already_deleted' };
    }

    await connection.execute(
      `UPDATE users
       SET deleted_phone = phone,
           phone = ?,
           deleted_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND role = 'user' AND deleted_at IS NULL`,
      [buildDeletedPhone(user.id, user.phone), user.id]
    );

    await connection.execute(
      `UPDATE products
       SET deleted_from_status = status,
           status = 'deleted',
           deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP),
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ? AND status <> 'deleted'`,
      [user.id]
    );

    await connection.commit();
    return { ok: true };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

async function restoreUser(userId) {
  const pool = getPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [[user]] = await connection.execute(
      "SELECT id, deleted_phone, deleted_at FROM users WHERE id = ? AND role = 'user' FOR UPDATE",
      [userId]
    );

    if (!user || !user.deleted_at) {
      await connection.rollback();
      return { ok: false, reason: 'not_found' };
    }

    if (!user.deleted_phone) {
      await connection.rollback();
      return { ok: false, reason: 'missing_phone' };
    }

    const [[phoneOwner]] = await connection.execute(
      'SELECT id FROM users WHERE phone = ? AND id <> ? LIMIT 1',
      [user.deleted_phone, user.id]
    );

    if (phoneOwner) {
      await connection.rollback();
      return { ok: false, reason: 'phone_conflict' };
    }

    await connection.execute(
      `UPDATE users
       SET phone = deleted_phone,
           deleted_phone = NULL,
           deleted_at = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND role = 'user'`,
      [user.id]
    );

    await connection.commit();
    return { ok: true };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

async function permanentlyDeleteUser(userId) {
  const pool = getPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [[user]] = await connection.execute(
      "SELECT id, deleted_at FROM users WHERE id = ? AND role = 'user' FOR UPDATE",
      [userId]
    );

    if (!user || !user.deleted_at) {
      await connection.rollback();
      return { ok: false, reason: 'not_found' };
    }

    const [productRows] = await connection.execute(
      'SELECT id FROM products WHERE user_id = ?',
      [user.id]
    );
    const productIds = productRows.map(row => row.id);

    await connection.execute(
      'DELETE FROM orders WHERE buyer_id = ? OR seller_id = ?',
      [user.id, user.id]
    );

    if (productIds.length > 0) {
      const placeholders = productIds.map(() => '?').join(',');
      await connection.execute(
        `DELETE FROM orders WHERE product_id IN (${placeholders})`,
        productIds
      );
      await connection.execute(
        `DELETE FROM products WHERE id IN (${placeholders})`,
        productIds
      );
    }

    await connection.execute(
      "DELETE FROM users WHERE id = ? AND role = 'user'",
      [user.id]
    );

    await connection.commit();
    return { ok: true };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

async function softDeleteProduct(productId) {
  const pool = getPool();
  const [result] = await pool.execute(
    `UPDATE products
     SET deleted_from_status = status,
         status = 'deleted',
         deleted_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND status <> 'deleted'`,
    [productId]
  );

  return { ok: result.affectedRows > 0 };
}

async function restoreProduct(productId) {
  const pool = getPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [[product]] = await connection.execute(
      `SELECT products.id,
              products.deleted_from_status,
              products.status,
              users.deleted_at AS user_deleted_at
       FROM products
       JOIN users ON products.user_id = users.id
       WHERE products.id = ?
       FOR UPDATE`,
      [productId]
    );

    if (!product || product.status !== 'deleted') {
      await connection.rollback();
      return { ok: false, reason: 'not_found' };
    }

    if (product.user_deleted_at) {
      await connection.rollback();
      return { ok: false, reason: 'owner_deleted' };
    }

    const restoreStatus = ['available', 'sold'].includes(product.deleted_from_status)
      ? product.deleted_from_status
      : 'available';

    await connection.execute(
      `UPDATE products
       SET status = ?,
           deleted_from_status = NULL,
           deleted_at = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [restoreStatus, product.id]
    );

    await connection.commit();
    return { ok: true };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

async function permanentlyDeleteProduct(productId) {
  const pool = getPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [[product]] = await connection.execute(
      "SELECT id, status FROM products WHERE id = ? FOR UPDATE",
      [productId]
    );

    if (!product || product.status !== 'deleted') {
      await connection.rollback();
      return { ok: false, reason: 'not_found' };
    }

    await connection.execute('DELETE FROM orders WHERE product_id = ?', [product.id]);
    await connection.execute("DELETE FROM products WHERE id = ? AND status = 'deleted'", [product.id]);

    await connection.commit();
    return { ok: true };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

async function listRecycleBin() {
  const pool = getPool();
  const [users] = await pool.execute(
    `SELECT id, deleted_phone AS phone, nickname, created_at, deleted_at
     FROM users
     WHERE role = 'user' AND deleted_at IS NOT NULL
     ORDER BY deleted_at DESC`
  );

  const [products] = await pool.execute(
    `SELECT products.*,
            users.nickname,
            COALESCE(users.deleted_phone, users.phone) AS seller_phone,
            users.deleted_at AS seller_deleted_at
     FROM products
     JOIN users ON products.user_id = users.id
     WHERE products.status = 'deleted'
     ORDER BY products.deleted_at DESC, products.updated_at DESC`
  );

  return { users, products };
}

module.exports = {
  softDeleteUser,
  restoreUser,
  permanentlyDeleteUser,
  softDeleteProduct,
  restoreProduct,
  permanentlyDeleteProduct,
  listRecycleBin
};
