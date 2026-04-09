module.exports = {
  secret: process.env.SESSION_SECRET || 'pbl6_secret_key_2024',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
};