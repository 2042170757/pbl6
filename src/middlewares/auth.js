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
  requireAdmin,
  attachCurrentUser
};
