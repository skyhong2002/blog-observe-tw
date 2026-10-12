CREATE TABLE `content_attempts` (
	`id` char(64) NOT NULL,
	`post_id` int NOT NULL,
	`blog_id` int NOT NULL,
	`source_kind` varchar(32) NOT NULL,
	`source_url` varchar(1024) NOT NULL,
	`adapter_id` varchar(64) NOT NULL,
	`status` varchar(32) NOT NULL,
	`reason` varchar(64),
	`content_hash` char(64),
	`raw_bytes` int NOT NULL,
	`observed_at` datetime NOT NULL,
	CONSTRAINT `content_attempts_id` PRIMARY KEY(`id`)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `content_blog_rules` (
	`blog_id` int NOT NULL,
	`platform` varchar(32) NOT NULL,
	`adapter_id` varchar(64) NOT NULL,
	`adapter_version` varchar(32) NOT NULL,
	`rules` json NOT NULL,
	`rule_source` varchar(16) NOT NULL,
	`rule_revision` int NOT NULL DEFAULT 1,
	`last_method` varchar(32),
	`last_status` varchar(32) NOT NULL DEFAULT 'pending',
	`last_error` varchar(64),
	`last_attempt_at` datetime,
	`last_success_at` datetime,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `content_blog_rules_blog_id` PRIMARY KEY(`blog_id`)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `content_post_bodies` (
	`post_id` int NOT NULL,
	`blog_id` int NOT NULL,
	`body_text` mediumtext,
	`body_html` mediumtext,
	`content_hash` char(64),
	`revision` int NOT NULL DEFAULT 1,
	`completeness` varchar(16) NOT NULL,
	`status` varchar(16) NOT NULL,
	`source_kind` varchar(32) NOT NULL,
	`source_url` varchar(1024) NOT NULL,
	`article_url` varchar(1024) NOT NULL,
	`adapter_id` varchar(64) NOT NULL,
	`adapter_version` varchar(32) NOT NULL,
	`rule_revision` int NOT NULL,
	`obtained_at` datetime NOT NULL,
	`source_updated_at` datetime,
	`next_attempt_at` datetime NOT NULL,
	`last_attempt_at` datetime NOT NULL,
	`last_error` varchar(64),
	`etag` varchar(512),
	`last_modified` varchar(255),
	`image_only` boolean NOT NULL DEFAULT false,
	`truncated` boolean NOT NULL DEFAULT false,
	`coverage` varchar(32) NOT NULL,
	`page_links` json,
	CONSTRAINT `content_post_bodies_post_id` PRIMARY KEY(`post_id`)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE INDEX `content_attempts_post` ON `content_attempts` (`post_id`,`observed_at`);--> statement-breakpoint
CREATE INDEX `content_attempts_date` ON `content_attempts` (`observed_at`);--> statement-breakpoint
CREATE INDEX `content_rules_status` ON `content_blog_rules` (`last_status`,`blog_id`);--> statement-breakpoint
CREATE INDEX `content_bodies_due` ON `content_post_bodies` (`next_attempt_at`,`post_id`);--> statement-breakpoint
CREATE INDEX `content_bodies_blog` ON `content_post_bodies` (`blog_id`,`status`);