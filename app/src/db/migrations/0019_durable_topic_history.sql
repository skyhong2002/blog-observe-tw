CREATE TABLE `topic_article_evidence` (
	`canonical_id` char(64) NOT NULL,
	`post_id` int NOT NULL,
	`source` varchar(16) NOT NULL,
	`state` varchar(16) NOT NULL DEFAULT 'pending',
	`reason` varchar(100),
	`source_snapshot_id` char(36) NOT NULL,
	`post_hash` char(64),
	`body_hash` char(64),
	`matcher_version` varchar(100) NOT NULL,
	`first_observed_at` datetime NOT NULL,
	`last_observed_at` datetime NOT NULL,
	`checked_at` datetime NOT NULL,
	`published_at` datetime,
	CONSTRAINT `topic_article_evidence_canonical_id_post_id_source_pk` PRIMARY KEY(`canonical_id`,`post_id`,`source`)
);
--> statement-breakpoint
CREATE TABLE `topic_history_backfill_runs` (
	`id` varchar(100) NOT NULL,
	`status` varchar(24) NOT NULL,
	`cursor` json,
	`processed` int NOT NULL DEFAULT 0,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `topic_history_backfill_runs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `topic_pages` (
	`canonical_id` char(64) NOT NULL,
	`label` varchar(255) NOT NULL,
	`normalized_label` varchar(255) NOT NULL,
	`state` varchar(16) NOT NULL DEFAULT 'pending',
	`merged_into` char(64),
	`reason` varchar(100),
	`first_snapshot_id` char(36) NOT NULL,
	`last_snapshot_id` char(36) NOT NULL,
	`first_observed_at` datetime NOT NULL,
	`last_observed_at` datetime NOT NULL,
	`last_article_at` datetime,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `topic_pages_canonical_id` PRIMARY KEY(`canonical_id`)
);
--> statement-breakpoint
CREATE INDEX `topic_history_post` ON `topic_article_evidence` (`post_id`,`canonical_id`);--> statement-breakpoint
CREATE INDEX `topic_history_work` ON `topic_article_evidence` (`state`,`checked_at`,`post_id`);--> statement-breakpoint
CREATE INDEX `topic_history_page` ON `topic_article_evidence` (`canonical_id`,`state`,`last_observed_at`,`post_id`);--> statement-breakpoint
CREATE INDEX `topic_pages_state` ON `topic_pages` (`state`,`canonical_id`);