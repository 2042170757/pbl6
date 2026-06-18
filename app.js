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
