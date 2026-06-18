const express = require('express');
const { listOrders } = require('../controllers/orderController');
const { requireUser } = require('../middlewares/auth');

const router = express.Router();

router.get('/orders', requireUser, listOrders);

module.exports = router;
