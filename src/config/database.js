module.exports = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'pbl6',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: false
};
