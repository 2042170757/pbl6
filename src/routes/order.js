const express = require('express');
const { listOrders } = require('../controllers/orderController');
const { requireCompletedProfile } = require('../middlewares/auth');

const router = express.Router();

router.get('/orders', requireCompletedProfile, listOrders);

module.exports = router;
