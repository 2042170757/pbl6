const bcrypt = require('bcryptjs');
const { getPool } = require('../services/databaseService');
const {
  getClientIp,
  getLoginFailureEntry,
  clearLoginFailures,
  clearLoginRequests,
  recordLoginFailure,
  getLockedUntilMessage
} = require('../middlewares/loginRateLimit');

function redirectHome(req, res) {
  if (req.session.user) {
    return req.session.user.role === 'admin'
      ? res.redirect('/admin')
      : res.redirect('/products');
  }

  return res.redirect('/login');
}

function showRegister(req, res) {
  res.render('user/register', { error: null });
}

async function register(req, res) {
  try {
    const { phone, password, confirmPassword } = req.body;
    const pool = getPool();

    if (!phone || !password || !confirmPassword) {
      return res.render('user/register', { error: '请填写所有字段' });
    }
    if (!/^\d{11}$/.test(phone)) {
      return res.render('user/register', { error: '手机号必须是11位数字' });
    }
    if (password.length < 6 || password.length > 18) {
      return res.render('user/register', { error: '密码长度需在6-18位之间' });
    }
    if (password !== confirmPassword) {
      return res.render('user/register', { error: '两次密码不一致' });
    }

    const [existing] = await pool.execute(
      'SELECT id FROM users WHERE phone = ?',
      [phone]
    );

    if (existing.length > 0) {
      return res.render('user/register', { error: '该手机号已注册，请登录' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.execute(
      'INSERT INTO users (phone, password, nickname, role) VALUES (?, ?, ?, ?)',
      [phone, hashedPassword, '新用户', 'user']
    );

    return res.redirect(`/login?success=${encodeURIComponent('注册成功，请登录')}`);
  } catch (err) {
    console.error(err);
    return res.render('user/register', { error: '注册失败，请稍后重试' });
  }
}

function showLogin(req, res) {
  res.render('user/login', {
    error: null,
    phone: '',
    success: req.query.success || null
  });
}

async function login(req, res) {
  try {
    const { phone, password } = req.body;
    const clientIp = getClientIp(req);
    const lockedEntry = getLoginFailureEntry(clientIp);
    const pool = getPool();

    if (lockedEntry?.lockUntil) {
      return res.status(429).render('user/login', {
        error: getLockedUntilMessage(lockedEntry.lockUntil),
        phone: phone || '',
        success: null
      });
    }

    if (!phone || !password) {
      return res.render('user/login', { error: '请填写手机号和密码', phone: '', success: null });
    }

    const [users] = await pool.execute(
      'SELECT * FROM users WHERE phone = ?',
      [phone]
    );

    if (users.length === 0) {
      recordLoginFailure(clientIp);
      return res.render('user/login', { error: '手机号或密码错误', phone: '', success: null });
    }

    const user = users[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      const failureEntry = recordLoginFailure(clientIp);
      if (failureEntry.lockUntil) {
        return res.status(429).render('user/login', {
          error: getLockedUntilMessage(failureEntry.lockUntil),
          phone: phone || '',
          success: null
        });
      }

      return res.render('user/login', { error: '手机号或密码错误', phone: '', success: null });
    }

    clearLoginRequests(clientIp);
    clearLoginFailures(clientIp);

    req.session.user = {
      id: user.id,
      phone: user.phone,
      nickname: user.nickname,
      role: user.role
    };

    if (user.role === 'admin') {
      return res.redirect('/admin');
    }

    return res.redirect('/products');
  } catch (err) {
    console.error(err);
    return res.render('user/login', { error: '登录失败，请稍后重试', phone: '', success: null });
  }
}

function logout(req, res) {
  req.session.destroy();
  res.redirect('/login');
}

module.exports = {
  redirectHome,
  showRegister,
  register,
  showLogin,
  login,
  logout
};
