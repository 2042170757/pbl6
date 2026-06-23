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

async function findUserById(userId) {
  const pool = getPool();
  const [users] = await pool.execute(
    'SELECT id, phone, password, nickname, campus, bio, profile_completed, role FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1',
    [userId]
  );

  return users[0] || null;
}

function syncSessionUser(req, user) {
  if (!req.session.user || !user) {
    return;
  }

  req.session.user.id = user.id;
  req.session.user.phone = user.phone;
  req.session.user.nickname = user.nickname;
  req.session.user.campus = user.campus || '';
  req.session.user.bio = user.bio || '';
  req.session.user.profileCompleted = Boolean(user.profile_completed);
  req.session.user.role = user.role;
}

function buildProfileViewModel(req, profile, overrides = {}) {
  return {
    user: req.session.user,
    profile: {
      phone: profile?.phone || '',
      nickname: Object.prototype.hasOwnProperty.call(overrides, 'nickname')
        ? overrides.nickname
        : (profile?.nickname || ''),
      campus: Object.prototype.hasOwnProperty.call(overrides, 'campus')
        ? overrides.campus
        : (profile?.campus || ''),
      bio: Object.prototype.hasOwnProperty.call(overrides, 'bio')
        ? overrides.bio
        : (profile?.bio || ''),
      profileCompleted: Boolean(profile?.profile_completed)
    },
    error: overrides.error || null,
    success: overrides.success || null,
    activeForm: overrides.activeForm || 'profile',
    isSetupMode: Boolean(overrides.isSetupMode)
  };
}

function redirectHome(req, res) {
  if (req.session.user) {
    if (req.session.user.role === 'user' && req.session.user.profileCompleted === false) {
      return res.redirect('/profile?setup=1');
    }

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
      'SELECT id FROM users WHERE phone = ? AND deleted_at IS NULL',
      [phone]
    );

    if (existing.length > 0) {
      return res.render('user/register', { error: '该手机号已注册，请登录' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.execute(
      'INSERT INTO users (phone, password, nickname, campus, bio, profile_completed, role) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [phone, hashedPassword, '新用户', '', '', 0, 'user']
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
      'SELECT * FROM users WHERE phone = ? AND deleted_at IS NULL',
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
      campus: user.campus || '',
      bio: user.bio || '',
      profileCompleted: Boolean(user.profile_completed),
      role: user.role
    };

    if (user.role === 'admin') {
      return res.redirect('/admin');
    }

    if (!user.profile_completed) {
      return res.redirect('/profile?setup=1');
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

async function showProfile(req, res) {
  try {
    const currentUser = await findUserById(req.session.user.id);

    if (!currentUser) {
      return res.redirect('/logout');
    }

    syncSessionUser(req, currentUser);

    return res.render(
      'user/profile',
      buildProfileViewModel(req, currentUser, {
        success: req.query.success || null,
        activeForm: req.query.form === 'password' ? 'password' : 'profile',
        isSetupMode: req.query.setup === '1' || !currentUser.profile_completed
      })
    );
  } catch (err) {
    console.error(err);
    return res.render(
      'user/profile',
      buildProfileViewModel(req, req.session.user, {
        error: '资料加载失败，请稍后重试'
      })
    );
  }
}

async function updateProfile(req, res) {
  const formType = req.body.formType;

  try {
    const currentUser = await findUserById(req.session.user.id);

    if (!currentUser) {
      return res.redirect('/logout');
    }

    syncSessionUser(req, currentUser);

    if (formType === 'profile') {
      const nickname = (req.body.nickname || '').trim();
      const campus = (req.body.campus || '').trim();
      const bio = (req.body.bio || '').trim();

      if (!nickname) {
        return res.render(
          'user/profile',
          buildProfileViewModel(req, currentUser, {
            nickname,
            campus,
            bio,
            error: '请输入昵称',
            activeForm: 'profile',
            isSetupMode: !currentUser.profile_completed
          })
        );
      }

      if (nickname.length > 50) {
        return res.render(
          'user/profile',
          buildProfileViewModel(req, currentUser, {
            nickname,
            campus,
            bio,
            error: '昵称最多50个字符',
            activeForm: 'profile',
            isSetupMode: !currentUser.profile_completed
          })
        );
      }

      if (!campus) {
        return res.render(
          'user/profile',
          buildProfileViewModel(req, currentUser, {
            nickname,
            campus,
            bio,
            error: '请输入校区、学院或常用交易地点',
            activeForm: 'profile',
            isSetupMode: !currentUser.profile_completed
          })
        );
      }

      if (campus.length > 100) {
        return res.render(
          'user/profile',
          buildProfileViewModel(req, currentUser, {
            nickname,
            campus,
            bio,
            error: '校区或常用交易地点最多100个字符',
            activeForm: 'profile',
            isSetupMode: !currentUser.profile_completed
          })
        );
      }

      if (bio.length > 255) {
        return res.render(
          'user/profile',
          buildProfileViewModel(req, currentUser, {
            nickname,
            campus,
            bio,
            error: '个人简介最多255个字符',
            activeForm: 'profile',
            isSetupMode: !currentUser.profile_completed
          })
        );
      }

      await getPool().execute(
        `UPDATE users
         SET nickname = ?, campus = ?, bio = ?, profile_completed = 1, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [nickname, campus, bio, currentUser.id]
      );

      req.session.user.nickname = nickname;
      req.session.user.campus = campus;
      req.session.user.bio = bio;
      req.session.user.profileCompleted = true;

      if (!currentUser.profile_completed) {
        return res.redirect(`/products?success=${encodeURIComponent('资料已完善，开始浏览商品吧')}`);
      }

      return res.redirect(`/profile?success=${encodeURIComponent('资料更新成功')}`);
    }

    if (formType === 'password') {
      const oldPassword = req.body.oldPassword || '';
      const newPassword = req.body.newPassword || '';
      const confirmPassword = req.body.confirmPassword || '';

      if (!oldPassword || !newPassword || !confirmPassword) {
        return res.render(
          'user/profile',
          buildProfileViewModel(req, currentUser, {
            error: '请填写完整的密码信息',
            activeForm: 'password',
            isSetupMode: !currentUser.profile_completed
          })
        );
      }

      if (newPassword.length < 6 || newPassword.length > 18) {
        return res.render(
          'user/profile',
          buildProfileViewModel(req, currentUser, {
            error: '新密码长度需在6-18位之间',
            activeForm: 'password',
            isSetupMode: !currentUser.profile_completed
          })
        );
      }

      if (newPassword !== confirmPassword) {
        return res.render(
          'user/profile',
          buildProfileViewModel(req, currentUser, {
            error: '两次输入的新密码不一致',
            activeForm: 'password',
            isSetupMode: !currentUser.profile_completed
          })
        );
      }

      const isOldPasswordValid = await bcrypt.compare(oldPassword, currentUser.password);
      if (!isOldPasswordValid) {
        return res.render(
          'user/profile',
          buildProfileViewModel(req, currentUser, {
            error: '旧密码验证失败',
            activeForm: 'password',
            isSetupMode: !currentUser.profile_completed
          })
        );
      }

      const isSamePassword = await bcrypt.compare(newPassword, currentUser.password);
      if (isSamePassword) {
        return res.render(
          'user/profile',
          buildProfileViewModel(req, currentUser, {
            error: '新密码不能与旧密码相同',
            activeForm: 'password',
            isSetupMode: !currentUser.profile_completed
          })
        );
      }

      const hashedPassword = await bcrypt.hash(newPassword, 10);
      await getPool().execute(
        'UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [hashedPassword, currentUser.id]
      );

      return res.redirect(`/profile?success=${encodeURIComponent('密码修改成功')}&form=password`);
    }

    return res.status(400).render(
      'user/profile',
      buildProfileViewModel(req, currentUser, {
        error: '无效的资料更新请求'
      })
    );
  } catch (err) {
    console.error(err);
    return res.render(
      'user/profile',
      buildProfileViewModel(req, req.session.user, {
        error: '资料更新失败，请稍后重试',
        activeForm: formType === 'password' ? 'password' : 'profile',
        nickname: (req.body.nickname || '').trim(),
        campus: (req.body.campus || '').trim(),
        bio: (req.body.bio || '').trim()
      })
    );
  }
}

module.exports = {
  redirectHome,
  showRegister,
  register,
  showLogin,
  login,
  logout,
  showProfile,
  updateProfile
};
