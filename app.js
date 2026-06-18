require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const sessionConfig = require('./src/config/session');
const { ensureCsrfToken, validateStateChangingRequests } = require('./src/middlewares/csrf');
const { attachCurrentUser } = require('./src/middlewares/auth');
const authRoutes = require('./src/routes/auth');
const productRoutes = require('./src/routes/product');
const orderRoutes = require('./src/routes/order');
const adminRoutes = require('./src/routes/admin');
const { initDatabase } = require('./src/services/databaseService');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'src/views'));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'src/public')));
app.use(session(sessionConfig));
app.use(ensureCsrfToken);
app.use(validateStateChangingRequests);
app.use(attachCurrentUser);

app.use(authRoutes);
app.use(productRoutes);
app.use(orderRoutes);
app.use(adminRoutes);

app.use((req, res) => {
  res.status(404).render('error', {
    title: '页面未找到',
    statusCode: 404,
    message: '你访问的页面不存在，可能已被移动或删除。'
  });
});

app.use((err, req, res, next) => {
  console.error(err);

  if (res.headersSent) {
    return next(err);
  }

  return res.status(500).render('error', {
    title: '服务器内部错误',
    statusCode: 500,
    message: '服务器处理请求时出现异常，请稍后重试。'
  });
});

initDatabase()
  .then(() => {
    const port = process.env.PORT || 3000;
    app.listen(port, () => {
      console.log(`Server running on port ${port}`);
    });
  })
  .catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
