const LOGIN_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const LOGIN_RATE_LIMIT_MAX_ATTEMPTS = 5;
const LOGIN_FAILURE_LOCK_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_FAILURE_LOCK_MAX_ATTEMPTS = 5;

const loginRequests = new Map();
const loginFailures = new Map();

function getClientIp(req) {
  return req.ip || req.connection?.remoteAddress || 'unknown';
}

function getLoginFailureEntry(ip) {
  const entry = loginFailures.get(ip);
  if (!entry) {
    return null;
  }

  if (entry.lockUntil && entry.lockUntil <= Date.now()) {
    loginFailures.delete(ip);
    return null;
  }

  return entry;
}

function clearLoginFailures(ip) {
  loginFailures.delete(ip);
}

function clearLoginRequests(ip) {
  loginRequests.delete(ip);
}

function cleanupLoginRequestEntry(ip) {
  const entry = loginRequests.get(ip);
  if (!entry) {
    return null;
  }

  const now = Date.now();
  entry.timestamps = entry.timestamps.filter(timestamp => now - timestamp < LOGIN_RATE_LIMIT_WINDOW_MS);

  if (entry.timestamps.length === 0) {
    loginRequests.delete(ip);
    return null;
  }

  return entry;
}

function recordLoginRequest(ip) {
  const now = Date.now();
  const entry = cleanupLoginRequestEntry(ip) || { timestamps: [] };
  entry.timestamps.push(now);
  loginRequests.set(ip, entry);
  return entry;
}

function getRateLimitMessage() {
  return '登录请求过于频繁，请 1 分钟后再试';
}

function recordLoginFailure(ip) {
  const now = Date.now();
  const entry = getLoginFailureEntry(ip);
  const nextEntry = entry && now - entry.firstFailureAt <= LOGIN_FAILURE_LOCK_WINDOW_MS
    ? { ...entry, count: entry.count + 1 }
    : { count: 1, firstFailureAt: now, lockUntil: null };

  if (nextEntry.count >= LOGIN_FAILURE_LOCK_MAX_ATTEMPTS) {
    nextEntry.lockUntil = now + LOGIN_FAILURE_LOCK_WINDOW_MS;
  }

  loginFailures.set(ip, nextEntry);
  return nextEntry;
}

function getLockedUntilMessage(lockUntil) {
  const remainingMinutes = Math.max(1, Math.ceil((lockUntil - Date.now()) / 60000));
  return `登录失败次数过多，请 ${remainingMinutes} 分钟后再试`;
}

function loginRateLimiter(req, res, next) {
  const clientIp = getClientIp(req);
  const lockedEntry = getLoginFailureEntry(clientIp);

  if (lockedEntry?.lockUntil) {
    return res.status(429).render('user/login', {
      error: getLockedUntilMessage(lockedEntry.lockUntil),
      phone: req.body?.phone || ''
    });
  }

  const entry = recordLoginRequest(clientIp);
  if (entry.timestamps.length > LOGIN_RATE_LIMIT_MAX_ATTEMPTS) {
    return res.status(429).render('user/login', {
      error: getRateLimitMessage(),
      phone: req.body?.phone || ''
    });
  }

  next();
}

module.exports = {
  loginRateLimiter,
  getClientIp,
  getLoginFailureEntry,
  clearLoginFailures,
  clearLoginRequests,
  recordLoginFailure,
  getLockedUntilMessage
};
