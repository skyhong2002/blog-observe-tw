CREATE TABLE site_claims (
  id int NOT NULL AUTO_INCREMENT PRIMARY KEY,
  home_key char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  home_url varchar(1024) NOT NULL,
  user_id int NOT NULL,
  candidate_id int NOT NULL,
  method varchar(16) NOT NULL,
  relationship varchar(16) NOT NULL,
  token varchar(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'pending',
  expires_at datetime NOT NULL,
  verified_at datetime NULL,
  last_attempt_at datetime NULL,
  proof_url varchar(1024) NULL,
  proof_sha256 char(64) NULL,
  created_at datetime NOT NULL,
  UNIQUE KEY site_claim_token (token),
  KEY site_claim_home (home_key,status),
  KEY site_claim_user (user_id,created_at)
);
--> statement-breakpoint
CREATE TABLE site_recommendations (
  id int NOT NULL AUTO_INCREMENT PRIMARY KEY,
  home_key char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  home_url varchar(1024) NOT NULL,
  user_id int NOT NULL,
  candidate_id int NOT NULL,
  reason varchar(500) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'active',
  created_at datetime NOT NULL,
  UNIQUE KEY site_recommendation_user_home (user_id,home_key),
  KEY site_recommendation_home (home_key,status),
  KEY site_recommendation_daily (user_id,created_at)
);
--> statement-breakpoint
CREATE TABLE site_review_requests (
  candidate_id int NOT NULL PRIMARY KEY,
  user_id int NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'pending',
  requested_at datetime NOT NULL,
  processed_at datetime NULL,
  result varchar(96) NULL,
  KEY site_review_pending (status,requested_at),
  KEY site_review_daily (user_id,requested_at)
);
--> statement-breakpoint
CREATE TABLE site_identity_audits (
  id int NOT NULL AUTO_INCREMENT PRIMARY KEY,
  home_key char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id int NOT NULL,
  action varchar(32) NOT NULL,
  evidence json NOT NULL,
  created_at datetime NOT NULL,
  KEY site_identity_audit_home (home_key,created_at)
);
