const express = require('express');
const {
  dashboard,
  listUsers,
  deleteUser,
  listProducts,
  deleteProduct,
  listOrders
} = require('../controllers/adminController');
const { requireAdmin } = require('../middlewares/auth');

const router = express.Router();

router.get('/admin', requireAdmin, dashboard);
router.get('/admin/users', requireAdmin, listUsers);
router.post('/admin/users/delete/:id', requireAdmin, deleteUser);
router.get('/admin/products', requireAdmin, listProducts);
router.post('/admin/products/delete/:id', requireAdmin, deleteProduct);
router.get('/admin/orders', requireAdmin, listOrders);

module.exports = router;
