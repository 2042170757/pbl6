const crypto = require('crypto');
const { cleanupUploadedFiles } = require('./upload');

function ensureCsrfToken(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }

  res.locals.csrfToken = req.session.csrfToken;
  next();
}

function validateCsrf(req, res, next) {
  const token = req.body._csrf || req.get('x-csrf-token');
  if (!token || token !== req.session.csrfToken) {
    return res.status(403).send('表单已失效，请返回上一页重试');
  }

  next();
}

function validateUploadCsrf(req, res, next) {
  const token = req.body._csrf || req.get('x-csrf-token');
  if (!token || token !== req.session.csrfToken) {
    cleanupUploadedFiles(req.files);
    return res.status(403).send('表单已失效，请返回上一页重试');
  }

  next();
}

function validateStateChangingRequests(req, res, next) {
  if (
    req.method === 'GET' ||
    req.method === 'HEAD' ||
    req.method === 'OPTIONS' ||
    req.is('multipart/form-data')
  ) {
    return next();
  }

  return validateCsrf(req, res, next);
}

module.exports = {
  ensureCsrfToken,
  validateCsrf,
  validateUploadCsrf,
  validateStateChangingRequests
};
