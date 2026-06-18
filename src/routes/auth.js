const express = require('express');
const {
  redirectHome,
  showRegister,
  register,
  showLogin,
  login,
  logout,
  showProfile,
  updateProfile
} = require('../controllers/authController');
const { loginRateLimiter } = require('../middlewares/loginRateLimit');
const { requireUser } = require('../middlewares/auth');

const router = express.Router();

router.get('/', redirectHome);
router.get('/register', showRegister);
router.post('/register', register);
router.get('/login', showLogin);
router.post('/login', loginRateLimiter, login);
router.get('/profile', requireUser, showProfile);
router.post('/profile', requireUser, updateProfile);
router.get('/logout', logout);

module.exports = router;
