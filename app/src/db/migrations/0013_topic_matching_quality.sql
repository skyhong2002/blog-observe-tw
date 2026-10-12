CREATE TABLE `topic_canonical_terms` (
	`snapshot_id` char(36) NOT NULL,
	`id` char(64) NOT NULL,
	`normalized_label` varchar(255) NOT NULL,
	`label` varchar(255) NOT NULL,
	`exclusion_reason` varchar(64),
	`occurrences` int NOT NULL DEFAULT 0,
	`policy_version` varchar(128) NOT NULL,
	CONSTRAINT `topic_canonical_terms_snapshot_id_id_pk` PRIMARY KEY(`snapshot_id`,`id`)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `topic_matches_v2` (
	`post_id` int NOT NULL,
	`term_id` char(64) NOT NULL,
	`snapshot_id` char(36) NOT NULL,
	`source` varchar(16) NOT NULL,
	CONSTRAINT `topic_matches_v2_post_id_term_id_source_pk` PRIMARY KEY(`post_id`,`term_id`,`source`)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `topic_post_indexes_v2` (
	`post_id` int NOT NULL,
	`snapshot_id` char(36) NOT NULL,
	`input_hash` char(64) NOT NULL,
	`post_hash` char(64),
	`body_hash` char(64),
	`matched_at` datetime NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'ok',
	`matcher_version` varchar(128) NOT NULL,
	`cleanup_version` varchar(64) NOT NULL,
	`body_kind` varchar(16) NOT NULL,
	`body_obtained_at` datetime,
	CONSTRAINT `topic_post_indexes_v2_post_id` PRIMARY KEY(`post_id`)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `topic_term_aliases` (
	`snapshot_id` char(36) NOT NULL,
	`term_id` char(64) NOT NULL,
	`canonical_id` char(64) NOT NULL,
	CONSTRAINT `topic_term_aliases_snapshot_id_term_id_pk` PRIMARY KEY(`snapshot_id`,`term_id`)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE INDEX `topic_canonical_label` ON `topic_canonical_terms` (`snapshot_id`,`normalized_label`);--> statement-breakpoint
CREATE INDEX `topic_matches_v2_term` ON `topic_matches_v2` (`snapshot_id`,`term_id`);--> statement-breakpoint
CREATE INDEX `topic_indexes_v2_version` ON `topic_post_indexes_v2` (`snapshot_id`,`matcher_version`);--> statement-breakpoint
CREATE INDEX `topic_alias_canonical` ON `topic_term_aliases` (`snapshot_id`,`canonical_id`);