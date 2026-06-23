CREATE DATABASE IF NOT EXISTS pbl6 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE pbl6;

CREATE TABLE IF NOT EXISTS users (
  id INT PRIMARY KEY AUTO_INCREMENT,
  phone VARCHAR(11) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  nickname VARCHAR(50) DEFAULT '新用户',
  campus VARCHAR(100) DEFAULT '',
  bio VARCHAR(255) DEFAULT '',
  profile_completed TINYINT(1) NOT NULL DEFAULT 1,
  role ENUM('user', 'admin') DEFAULT 'user',
  deleted_phone VARCHAR(11) DEFAULT NULL,
  deleted_at DATETIME DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_users_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS products (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  title VARCHAR(100) NOT NULL,
  description TEXT,
  price DECIMAL(10, 2) NOT NULL,
  images JSON,
  status ENUM('available', 'sold', 'deleted') DEFAULT 'available',
  deleted_from_status VARCHAR(20) DEFAULT NULL,
  deleted_at DATETIME DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_products_status_created (status, created_at),
  INDEX idx_products_user_id (user_id),
  INDEX idx_products_created_at (created_at),
  INDEX idx_products_deleted_at (deleted_at),
  CONSTRAINT fk_products_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS orders (
  id INT PRIMARY KEY AUTO_INCREMENT,
  product_id INT NOT NULL,
  buyer_id INT NOT NULL,
  seller_id INT NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  status ENUM('pending','confirmed','cancelled','refunded') DEFAULT 'pending',
  receiver_name VARCHAR(50),
  receiver_phone VARCHAR(20),
  receiver_address VARCHAR(255),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_orders_buyer_created (buyer_id, created_at),
  INDEX idx_orders_seller_created (seller_id, created_at),
  INDEX idx_orders_status (status),
  CONSTRAINT fk_orders_product FOREIGN KEY (product_id) REFERENCES products(id),
  CONSTRAINT fk_orders_buyer FOREIGN KEY (buyer_id) REFERENCES users(id),
  CONSTRAINT fk_orders_seller FOREIGN KEY (seller_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
