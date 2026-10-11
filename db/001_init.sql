CREATE TABLE IF NOT EXISTS blogs (
  id INT AUTO_INCREMENT PRIMARY KEY, slug VARCHAR(180) NOT NULL UNIQUE, name VARCHAR(255) NOT NULL,
  url VARCHAR(1024), canonical_host VARCHAR(255), category VARCHAR(255) NOT NULL DEFAULT '待分類',
  description TEXT, status VARCHAR(32) NOT NULL DEFAULT 'seed', status_label VARCHAR(64) NOT NULL DEFAULT '待核對',
  source_sha256 CHAR(64), source_row INT, source_name VARCHAR(255), source_category VARCHAR(255),
  source_values JSON, discovered_at DATETIME NOT NULL, last_crawled_at DATETIME NULL,
  last_published_at DATETIME NULL, expected_interval_hours INT NOT NULL DEFAULT 168,
  INDEX blogs_status (status), INDEX blogs_category (category)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS blog_urls (
  id INT AUTO_INCREMENT PRIMARY KEY, blog_id INT NOT NULL, url VARCHAR(1024) NOT NULL UNIQUE,
  kind VARCHAR(32) NOT NULL DEFAULT 'primary', is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  discovered_at DATETIME NOT NULL, INDEX blog_urls_blog (blog_id)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS seed_records (
  id INT AUTO_INCREMENT PRIMARY KEY, source_path VARCHAR(1024) NOT NULL, source_sha256 CHAR(64) NOT NULL,
  source_row INT NOT NULL, original_name VARCHAR(255) NOT NULL, original_category VARCHAR(255),
  original_values JSON NOT NULL, blog_id INT NULL, duplicate_of INT NULL, imported_at DATETIME NOT NULL,
  UNIQUE KEY seed_records_source_row (source_sha256, source_row), INDEX seed_records_name (original_name)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS feed_sources (
  id INT AUTO_INCREMENT PRIMARY KEY, blog_id INT NOT NULL, url VARCHAR(1024) NOT NULL UNIQUE,
  type VARCHAR(32) NOT NULL DEFAULT 'rss', etag VARCHAR(512), last_modified VARCHAR(255),
  last_success_at DATETIME NULL, last_error_at DATETIME NULL, consecutive_failures INT NOT NULL DEFAULT 0,
  INDEX feed_sources_blog (blog_id)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS posts (
  id INT AUTO_INCREMENT PRIMARY KEY, blog_id INT NOT NULL, guid VARCHAR(1024) NOT NULL, url VARCHAR(1024) NOT NULL,
  title VARCHAR(512) NOT NULL, summary TEXT, author VARCHAR(255), published_at DATETIME NULL, updated_at DATETIME NULL,
  image_url VARCHAR(1024), content_hash CHAR(64), source_type VARCHAR(32) NOT NULL DEFAULT 'feed', created_at DATETIME NOT NULL,
  UNIQUE KEY posts_blog_guid (blog_id, guid), INDEX posts_published (published_at), INDEX posts_blog_published (blog_id, published_at)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY, google_sub VARCHAR(255) NOT NULL UNIQUE, email VARCHAR(255) NOT NULL,
  name VARCHAR(255), picture VARCHAR(1024), created_at DATETIME NOT NULL, last_login_at DATETIME NOT NULL,
  INDEX users_email (email)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS user_sessions (
  token_hash CHAR(64) PRIMARY KEY, user_id INT NOT NULL, created_at DATETIME NOT NULL, expires_at DATETIME NOT NULL,
  INDEX user_sessions_expires (expires_at), INDEX user_sessions_user (user_id)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS user_follows (
  user_id INT NOT NULL, blog_id INT NOT NULL, created_at DATETIME NOT NULL, PRIMARY KEY (user_id, blog_id), INDEX user_follows_blog (blog_id)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS discovery_candidates (
  id INT AUTO_INCREMENT PRIMARY KEY, url VARCHAR(1024) NOT NULL, name VARCHAR(255), source_type VARCHAR(64) NOT NULL,
  source_url VARCHAR(1024), source_evidence JSON, status VARCHAR(32) NOT NULL DEFAULT 'candidate', discovered_at DATETIME NOT NULL,
  UNIQUE KEY discovery_candidates_url_source (url, source_type), INDEX discovery_candidates_status (status)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS blog_links (
  from_blog_id INT NOT NULL, to_blog_id INT NOT NULL, relation VARCHAR(32) NOT NULL DEFAULT 'blogroll',
  source_url VARCHAR(1024), discovered_at DATETIME NOT NULL, PRIMARY KEY (from_blog_id, to_blog_id, relation)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
