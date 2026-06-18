const express = require('express');
const {
  redirectHome,
  showRegister,
  register,
  showLogin,
  login,
  logout
} = require('../controllers/authController');
const { loginRateLimiter } = require('../middlewares/loginRateLimit');

const router = express.Router();

router.get('/', redirectHome);
router.get('/register', showRegister);
router.post('/register', register);
router.get('/login', showLogin);
router.post('/login', loginRateLimiter, login);
router.get('/logout', logout);

module.exports = router;
