-- BCA Messenger: MySQL 8 / MariaDB 10.6+.
-- Import ONCE into an EMPTY database only. No DROP, TRUNCATE or automatic DDL.
-- Set UTC for this connection. Application connections also use UTC.
SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE users (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  username VARCHAR(191) NOT NULL,
  credential_hash TEXT NOT NULL,
  phone VARCHAR(64) NOT NULL DEFAULT '',
  avatar_file_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT bca_member_pair_unique UNIQUE (username, phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE admins (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  username VARCHAR(191) NOT NULL UNIQUE,
  credential_hash TEXT NOT NULL,
  phone VARCHAR(64) NOT NULL DEFAULT '',
  avatar_file_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE presence (
  account_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  role VARCHAR(16) NOT NULL,
  last_seen DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE sessions (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  account_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  role VARCHAR(16) NOT NULL,
  refresh_hash VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
  expires_at DATETIME(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE conversations (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
  favorite BOOLEAN NOT NULL DEFAULT FALSE,
  last_message_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT conversations_user_fk FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE files (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  owner_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  conversation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  purpose VARCHAR(32) NOT NULL,
  path TEXT NOT NULL,
  mime VARCHAR(255) NOT NULL,
  size INTEGER NOT NULL,
  duration DOUBLE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT files_conversation_fk FOREIGN KEY (conversation_id) REFERENCES conversations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE messages (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  conversation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  sender_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  sender_role VARCHAR(16) NOT NULL,
  type VARCHAR(16) NOT NULL,
  content LONGTEXT NOT NULL,
  file_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  duration DOUBLE,
  status VARCHAR(16) NOT NULL DEFAULT 'sent',
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  reply_to_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  hidden_for TEXT NOT NULL DEFAULT '[]',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT messages_conversation_fk FOREIGN KEY (conversation_id) REFERENCES conversations(id),
  CONSTRAINT messages_file_fk FOREIGN KEY (file_id) REFERENCES files(id),
  INDEX messages_conversation_created_idx (conversation_id, created_at),
  INDEX messages_unread_idx (conversation_id, is_read)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE push_subscriptions (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  account_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  role VARCHAR(16) NOT NULL,
  session_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  endpoint VARCHAR(2048) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
