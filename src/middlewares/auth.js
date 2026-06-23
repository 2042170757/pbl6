function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }

  next();
}

function requireUser(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'user') {
    return res.redirect('/login');
  }

  next();
}

function requireCompletedProfile(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }

  if (req.session.user.role === 'user' && req.session.user.profileCompleted === false) {
    return res.redirect('/profile?setup=1');
  }

  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.redirect('/login');
  }

  next();
}

function attachCurrentUser(req, res, next) {
  res.locals.user = req.session.user || null;
  next();
}

module.exports = {
  requireLogin,
  requireUser,
  requireCompletedProfile,
  requireAdmin,
  attachCurrentUser
};
