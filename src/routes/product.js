const express = require('express');
const {
  listProducts,
  showPublishForm,
  publishProduct,
  showEditProductForm,
  updateProduct,
  showProductDetail,
  buyProduct
} = require('../controllers/productController');
const { requireLogin, requireCompletedProfile } = require('../middlewares/auth');
const { validateUploadCsrf } = require('../middlewares/csrf');
const { upload } = require('../middlewares/upload');

const router = express.Router();

router.get('/products', requireLogin, requireCompletedProfile, listProducts);
router.get('/products/publish', requireCompletedProfile, showPublishForm);
router.post('/products/publish', requireCompletedProfile, upload.array('images', 6), validateUploadCsrf, publishProduct);
router.get('/products/:id/edit', requireCompletedProfile, showEditProductForm);
router.post('/products/:id/edit', requireCompletedProfile, upload.array('images', 6), validateUploadCsrf, updateProduct);
router.get('/products/:id', requireLogin, requireCompletedProfile, showProductDetail);
router.post('/products/:id/buy', requireCompletedProfile, buyProduct);

module.exports = router;
