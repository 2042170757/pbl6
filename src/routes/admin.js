const express = require('express');
const {
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
} = require('../controllers/adminController');
const { requireAdmin } = require('../middlewares/auth');

const router = express.Router();

router.get('/admin', requireAdmin, dashboard);
router.get('/admin/users', requireAdmin, listUsers);
router.post('/admin/users/delete/:id', requireAdmin, deleteUser);
router.get('/admin/products', requireAdmin, listProducts);
router.post('/admin/products/delete/:id', requireAdmin, deleteProduct);
router.get('/admin/recycle-bin', requireAdmin, recycleBin);
router.post('/admin/recycle-bin/users/:id/restore', requireAdmin, restoreDeletedUser);
router.post('/admin/recycle-bin/users/:id/purge', requireAdmin, purgeDeletedUser);
router.post('/admin/recycle-bin/products/:id/restore', requireAdmin, restoreDeletedProduct);
router.post('/admin/recycle-bin/products/:id/purge', requireAdmin, purgeDeletedProduct);
router.get('/admin/orders', requireAdmin, listOrders);

module.exports = router;
