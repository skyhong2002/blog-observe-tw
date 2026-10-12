CREATE TABLE `relation_home_links` (
	`blog_id` int NOT NULL,
	`source_page_hash` char(64) NOT NULL,
	`ordinal` int NOT NULL,
	`source_page_url` varchar(1024) NOT NULL,
	`target_url` varchar(1024) NOT NULL,
	`target_blog_id` int,
	`anchor_text` varchar(255) NOT NULL,
	`body_sha256` char(64) NOT NULL,
	`path` json NOT NULL,
	`observed_at` datetime NOT NULL,
	`resolution_checked_at` datetime NOT NULL,
	CONSTRAINT `relation_home_links_blog_id_source_page_hash_ordinal_pk` PRIMARY KEY(`blog_id`,`source_page_hash`,`ordinal`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `relation_home_scans` (
	`blog_id` int NOT NULL,
	`status` varchar(32) NOT NULL,
	`observed_at` datetime NOT NULL,
	`last_success_at` datetime,
	`next_attempt_at` datetime NOT NULL,
	`etag` varchar(512),
	`last_modified` varchar(255),
	`child_url` varchar(1024),
	`error_code` varchar(64),
	`truncated` boolean NOT NULL DEFAULT false,
	CONSTRAINT `relation_home_scans_blog_id` PRIMARY KEY(`blog_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
--> statement-breakpoint
ALTER TABLE `ai_results` ADD `last_error` varchar(64);--> statement-breakpoint
CREATE INDEX `relation_home_links_target` ON `relation_home_links` (`target_blog_id`);--> statement-breakpoint
CREATE INDEX `relation_home_links_resolution` ON `relation_home_links` (`resolution_checked_at`);--> statement-breakpoint
CREATE INDEX `relation_home_scans_due` ON `relation_home_scans` (`next_attempt_at`);