CREATE DATABASE IF NOT EXISTS analytics_db;

CREATE USER IF NOT EXISTS 'reader_user'@'%' IDENTIFIED BY 'readerpass';
CREATE USER IF NOT EXISTS 'writer_user'@'%' IDENTIFIED BY 'writerpass';

USE sample_db;

CREATE TABLE IF NOT EXISTS users (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(64) NOT NULL UNIQUE,
    display_name VARCHAR(128) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS posts (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT NOT NULL,
    title VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'draft',
    published_at TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_posts_user FOREIGN KEY (user_id) REFERENCES users(id)
);

INSERT INTO users (id, username, display_name, email, status) VALUES
    (1, 'gravis', 'Gravis', 'gravis@example.com', 'active'),
    (2, 'nova', 'Nova', 'nova@example.com', 'active'),
    (3, 'mio', 'Mio', 'mio@example.com', 'disabled')
ON DUPLICATE KEY UPDATE
    username = VALUES(username),
    display_name = VALUES(display_name),
    email = VALUES(email),
    status = VALUES(status);

INSERT INTO posts (id, user_id, title, body, status, published_at) VALUES
    (1, 1, 'Welcome to Modern DB Admin', 'This row is seeded for the MySQL browser.', 'published', CURRENT_TIMESTAMP),
    (2, 2, 'Sidebar should feel familiar', 'Database tree now exposes tables and views like phpMyAdmin.', 'published', CURRENT_TIMESTAMP),
    (3, 1, 'Draft entry', 'Use this row to test inline editing.', 'draft', NULL)
ON DUPLICATE KEY UPDATE
    user_id = VALUES(user_id),
    title = VALUES(title),
    body = VALUES(body),
    status = VALUES(status),
    published_at = VALUES(published_at);

CREATE OR REPLACE VIEW active_users AS
SELECT id, username, display_name, email, created_at
FROM users
WHERE status = 'active';

USE analytics_db;

CREATE TABLE IF NOT EXISTS daily_metrics (
    metric_date DATE NOT NULL,
    metric_name VARCHAR(64) NOT NULL,
    metric_value DECIMAL(12, 2) NOT NULL,
    PRIMARY KEY (metric_date, metric_name)
);

INSERT INTO daily_metrics (metric_date, metric_name, metric_value) VALUES
    (CURRENT_DATE(), 'active_users', 2.00),
    (CURRENT_DATE(), 'published_posts', 2.00)
ON DUPLICATE KEY UPDATE
    metric_value = VALUES(metric_value);

GRANT SELECT ON sample_db.* TO 'reader_user'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON sample_db.* TO 'writer_user'@'%';
GRANT SELECT ON analytics_db.* TO 'reader_user'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON analytics_db.* TO 'writer_user'@'%';

FLUSH PRIVILEGES;
