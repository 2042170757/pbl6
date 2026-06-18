const express = require('express');
const {
  listProducts,
  showPublishForm,
  publishProduct,
  showProductDetail,
  buyProduct
} = require('../controllers/productController');
const { requireLogin, requireUser } = require('../middlewares/auth');
const { validateUploadCsrf } = require('../middlewares/csrf');
const { upload } = require('../middlewares/upload');

const router = express.Router();

router.get('/products', requireLogin, listProducts);
router.get('/products/publish', requireUser, showPublishForm);
router.post('/products/publish', requireUser, upload.array('images', 6), validateUploadCsrf, publishProduct);
router.get('/products/:id', requireLogin, showProductDetail);
router.post('/products/:id/buy', requireUser, buyProduct);

module.exports = router;
