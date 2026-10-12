CREATE TABLE `topic_policy_selections` (
	`snapshot_id` char(36) NOT NULL,
	`policy_version` varchar(128) NOT NULL,
	`selection_id` char(64),
	`status` varchar(24) NOT NULL DEFAULT 'building',
	`cursor` char(64),
	`as_of` datetime NOT NULL,
	`total_terms` int NOT NULL DEFAULT 0,
	`eligible_terms` int NOT NULL DEFAULT 0,
	`active_terms` int NOT NULL DEFAULT 0,
	`code_points` int NOT NULL DEFAULT 0,
	`estimated_bytes` int NOT NULL DEFAULT 0,
	`config` json NOT NULL,
	CONSTRAINT `topic_policy_selections_snapshot_id` PRIMARY KEY(`snapshot_id`)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `topic_snapshot_pages` (
	`snapshot_id` char(36) NOT NULL,
	`page_index` int NOT NULL,
	`entries_json` longtext NOT NULL,
	`sha256` char(64) NOT NULL,
	CONSTRAINT `topic_snapshot_pages_snapshot_id_page_index_pk` PRIMARY KEY(`snapshot_id`,`page_index`)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `topic_snapshot_runs` (
	`snapshot_id` char(36) NOT NULL,
	`manifest` json NOT NULL,
	`next_page` int NOT NULL DEFAULT 0,
	`staged_terms` int NOT NULL DEFAULT 0,
	`staged_bytes` bigint NOT NULL DEFAULT 0,
	`last_label` varchar(255),
	`status` varchar(24) NOT NULL DEFAULT 'scanning',
	`next_attempt_at` datetime,
	`error_code` varchar(64),
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `topic_snapshot_runs_snapshot_id` PRIMARY KEY(`snapshot_id`)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
ALTER TABLE `topic_canonical_terms` ADD `article_count` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `topic_canonical_terms` ADD `last_published_at` datetime;--> statement-breakpoint
ALTER TABLE `topic_canonical_terms` ADD `winner_id` char(64);--> statement-breakpoint
ALTER TABLE `topic_canonical_terms` ADD `winner_count` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `topic_canonical_terms` ADD `inactive_reason` varchar(64);--> statement-breakpoint
CREATE INDEX `topic_snapshot_runs_status` ON `topic_snapshot_runs` (`status`,`updated_at`);
--> statement-breakpoint
CREATE INDEX `topic_canonical_activity` ON `topic_canonical_terms` (`snapshot_id`,`article_count`,`id`);
