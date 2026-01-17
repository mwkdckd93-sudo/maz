-- Mazad Database Schema
-- Iraqi Dinar Auction Platform

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- =====================================================
-- USERS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS `users` (
  `id` VARCHAR(36) PRIMARY KEY,
  `full_name` VARCHAR(100) NOT NULL,
  `phone` VARCHAR(20) UNIQUE NOT NULL,
  `email` VARCHAR(100) UNIQUE,
  `password_hash` VARCHAR(255) NOT NULL,
  `avatar_url` VARCHAR(500),
  `bio` TEXT,
  `wallet_balance` DECIMAL(15, 2) DEFAULT 0,
  `is_verified` BOOLEAN DEFAULT FALSE,
  `is_active` BOOLEAN DEFAULT TRUE,
  `role` ENUM('user', 'admin') DEFAULT 'user',
  `rating` DECIMAL(3, 2) DEFAULT 0,
  `total_auctions` INT DEFAULT 0,
  `total_bids` INT DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_phone` (`phone`),
  INDEX `idx_email` (`email`),
  INDEX `idx_role` (`role`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- ADDRESSES TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS `addresses` (
  `id` VARCHAR(36) PRIMARY KEY,
  `user_id` VARCHAR(36) NOT NULL,
  `label` VARCHAR(50),
  `city` VARCHAR(50) NOT NULL,
  `area` VARCHAR(100),
  `street` VARCHAR(200),
  `building` VARCHAR(100),
  `notes` TEXT,
  `is_primary` BOOLEAN DEFAULT FALSE,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- CATEGORIES TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS `categories` (
  `id` VARCHAR(36) PRIMARY KEY,
  `name` VARCHAR(50) NOT NULL,
  `name_ar` VARCHAR(50) NOT NULL,
  `icon` VARCHAR(50),
  `color` VARCHAR(20),
  `sort_order` INT DEFAULT 0,
  `is_active` BOOLEAN DEFAULT TRUE,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- AUCTIONS TABLE (Products/Items)
-- =====================================================
CREATE TABLE IF NOT EXISTS `auctions` (
  `id` VARCHAR(36) PRIMARY KEY,
  `seller_id` VARCHAR(36) NOT NULL,
  `category_id` VARCHAR(36) NOT NULL,
  `title` VARCHAR(200) NOT NULL,
  `description` TEXT,
  `starting_price` DECIMAL(15, 2) NOT NULL,
  `current_price` DECIMAL(15, 2) NOT NULL,
  `min_bid_increment` DECIMAL(15, 2) NOT NULL DEFAULT 5000,
  `buy_now_price` DECIMAL(15, 2),
  `start_time` TIMESTAMP NOT NULL,
  `end_time` TIMESTAMP NOT NULL,
  `status` ENUM('draft', 'pending', 'active', 'ended', 'sold', 'cancelled') DEFAULT 'draft',
  `bid_count` INT DEFAULT 0,
  `view_count` INT DEFAULT 0,
  `winner_id` VARCHAR(36),
  `condition` ENUM('new', 'like_new', 'good', 'fair') DEFAULT 'good',
  `location_city` VARCHAR(50),
  `is_featured` BOOLEAN DEFAULT FALSE,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (`seller_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`),
  FOREIGN KEY (`winner_id`) REFERENCES `users`(`id`) ON DELETE SET NULL,
  INDEX `idx_status` (`status`),
  INDEX `idx_end_time` (`end_time`),
  INDEX `idx_category` (`category_id`),
  INDEX `idx_seller` (`seller_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- AUCTION IMAGES TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS `auction_images` (
  `id` VARCHAR(36) PRIMARY KEY,
  `auction_id` VARCHAR(36) NOT NULL,
  `image_url` VARCHAR(500) NOT NULL,
  `is_primary` BOOLEAN DEFAULT FALSE,
  `sort_order` INT DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`auction_id`) REFERENCES `auctions`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- BIDS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS `bids` (
  `id` VARCHAR(36) PRIMARY KEY,
  `auction_id` VARCHAR(36) NOT NULL,
  `bidder_id` VARCHAR(36) NOT NULL,
  `amount` DECIMAL(15, 2) NOT NULL,
  `is_auto_bid` BOOLEAN DEFAULT FALSE,
  `max_auto_bid` DECIMAL(15, 2),
  `is_winning` BOOLEAN DEFAULT FALSE,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`auction_id`) REFERENCES `auctions`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`bidder_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  INDEX `idx_auction` (`auction_id`),
  INDEX `idx_bidder` (`bidder_id`),
  INDEX `idx_created` (`created_at` DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- WATCHLIST TABLE (Saved Auctions)
-- =====================================================
CREATE TABLE IF NOT EXISTS `watchlist` (
  `id` VARCHAR(36) PRIMARY KEY,
  `user_id` VARCHAR(36) NOT NULL,
  `auction_id` VARCHAR(36) NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`auction_id`) REFERENCES `auctions`(`id`) ON DELETE CASCADE,
  UNIQUE KEY `unique_watchlist` (`user_id`, `auction_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- NOTIFICATIONS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS `notifications` (
  `id` VARCHAR(36) PRIMARY KEY,
  `user_id` VARCHAR(36) NOT NULL,
  `type` ENUM('bid_placed', 'bid_outbid', 'auction_won', 'auction_ended', 'auction_starting', 'payment', 'system') NOT NULL,
  `title` VARCHAR(200) NOT NULL,
  `body` TEXT,
  `data` JSON,
  `is_read` BOOLEAN DEFAULT FALSE,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  INDEX `idx_user_unread` (`user_id`, `is_read`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- QUESTIONS & ANSWERS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS `questions` (
  `id` VARCHAR(36) PRIMARY KEY,
  `auction_id` VARCHAR(36) NOT NULL,
  `user_id` VARCHAR(36) NOT NULL,
  `question` TEXT NOT NULL,
  `answer` TEXT,
  `answered_at` TIMESTAMP,
  `is_public` BOOLEAN DEFAULT TRUE,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`auction_id`) REFERENCES `auctions`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- TRANSACTIONS TABLE (Wallet)
-- =====================================================
CREATE TABLE IF NOT EXISTS `transactions` (
  `id` VARCHAR(36) PRIMARY KEY,
  `user_id` VARCHAR(36) NOT NULL,
  `type` ENUM('deposit', 'withdrawal', 'bid_hold', 'bid_release', 'payment', 'refund', 'commission') NOT NULL,
  `amount` DECIMAL(15, 2) NOT NULL,
  `balance_after` DECIMAL(15, 2) NOT NULL,
  `reference_id` VARCHAR(36),
  `description` VARCHAR(200),
  `status` ENUM('pending', 'completed', 'failed', 'cancelled') DEFAULT 'pending',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  INDEX `idx_user` (`user_id`),
  INDEX `idx_created` (`created_at` DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- OTP VERIFICATION TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS `otp_codes` (
  `id` VARCHAR(36) PRIMARY KEY,
  `phone` VARCHAR(20) NOT NULL,
  `code` VARCHAR(6) NOT NULL,
  `expires_at` TIMESTAMP NOT NULL,
  `is_used` BOOLEAN DEFAULT FALSE,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_phone` (`phone`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- INSERT DEFAULT CATEGORIES
-- =====================================================
INSERT INTO `categories` (`id`, `name`, `name_ar`, `icon`, `color`, `sort_order`) VALUES
('cat-1', 'electronics', 'إلكترونيات', 'devices', '#2196F3', 1),
('cat-2', 'mobiles', 'موبايلات', 'smartphone', '#9C27B0', 2),
('cat-3', 'home_appliances', 'أجهزة منزلية', 'kitchen', '#FF9800', 3),
('cat-4', 'gaming', 'كيمينك', 'sports_esports', '#F44336', 4),
('cat-5', 'furniture', 'أثاث', 'chair', '#795548', 5),
('cat-6', 'watches', 'ساعات', 'watch', '#009688', 6),
('cat-7', 'cameras', 'كاميرات', 'camera_alt', '#607D8B', 7);

-- =====================================================
-- INSERT DEFAULT ADMIN USER
-- Email: admin@mazad.com | Password: Admin@123
-- =====================================================
INSERT INTO `users` (`id`, `full_name`, `phone`, `email`, `password_hash`, `role`, `is_verified`, `is_active`) VALUES
('admin-001', 'مدير النظام', '07700000000', 'admin@mazad.com', '$2a$10$8K1p/a0dL1LXMIgoEDFrwOaE4M1Z8TiMK7z5X8YzLl0bZ8YK5QITK', 'admin', TRUE, TRUE);

SET FOREIGN_KEY_CHECKS = 1;
