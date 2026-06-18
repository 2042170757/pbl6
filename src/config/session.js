const isProduction = process.env.NODE_ENV === 'production';

if (isProduction && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET is required in production');
}

module.exports = {
  secret: process.env.SESSION_SECRET || 'pbl6_dev_session_secret',
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
