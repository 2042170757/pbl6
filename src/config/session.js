const crypto = require('crypto');

const isProduction = process.env.NODE_ENV === 'production';
const configuredSecret = (process.env.SESSION_SECRET || '').trim();

if (isProduction && !configuredSecret) {
  throw new Error('SESSION_SECRET is required in production');
}

const sessionSecret = configuredSecret || crypto.randomBytes(32).toString('hex');

if (!isProduction && !configuredSecret) {
  console.warn('SESSION_SECRET is not configured. Using an ephemeral development secret.');
}

module.exports = {
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  name: 'pbl6.sid',
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 7,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production'
  }
};
