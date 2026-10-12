CREATE TABLE `work_budgets` (
	`day` char(10) NOT NULL,
	`scope` varchar(191) NOT NULL,
	`used` int NOT NULL DEFAULT 0,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `work_budgets_day_scope_pk` PRIMARY KEY(`day`,`scope`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `relation_candidate_identities` (
	`identity_hash` char(64) NOT NULL,
	`url` varchar(1024) NOT NULL,
	`candidate_id` int NOT NULL,
	`first_observed_at` datetime NOT NULL,
	CONSTRAINT `relation_candidate_identities_identity_hash` PRIMARY KEY(`identity_hash`),
	CONSTRAINT `relation_candidate_identity_candidate` UNIQUE(`candidate_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `relation_links` (
	`source_post_id` int NOT NULL,
	`source_blog_id` int NOT NULL,
	`ordinal` int NOT NULL,
	`target_url` varchar(1024) NOT NULL,
	`target_blog_id` int,
	`target_post_id` int,
	`anchor_text` varchar(255) NOT NULL,
	`context` varchar(320) NOT NULL,
	`location` varchar(16) NOT NULL,
	`observed_at` datetime NOT NULL,
	`resolution_checked_at` datetime NOT NULL,
	CONSTRAINT `relation_links_source_post_id_ordinal_pk` PRIMARY KEY(`source_post_id`,`ordinal`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `relation_observations` (
	`post_id` int NOT NULL,
	`blog_id` int NOT NULL,
	`body_text` text,
	`content_hash` char(64),
	`status` varchar(32) NOT NULL,
	`parser_version` varchar(32) NOT NULL,
	`extraction` varchar(64),
	`final_url` varchar(1024),
	`etag` varchar(512),
	`last_modified` varchar(255),
	`observed_at` datetime NOT NULL,
	`last_success_at` datetime,
	`next_attempt_at` datetime NOT NULL,
	`published_at` datetime,
	`truncated` boolean NOT NULL DEFAULT false,
	`external_links` int NOT NULL DEFAULT 0,
	`error_code` varchar(64),
	CONSTRAINT `relation_observations_post_id` PRIMARY KEY(`post_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `relation_publications` (
	`blog_id` int NOT NULL,
	`depth` int NOT NULL,
	`source_candidate_id` int,
	`admitted_at` datetime NOT NULL,
	CONSTRAINT `relation_publications_blog_id` PRIMARY KEY(`blog_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `ai_overrides` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entity_type` varchar(16) NOT NULL,
	`entity_id` int NOT NULL,
	`task` varchar(32) NOT NULL,
	`result_json` json NOT NULL,
	`actor` varchar(128) NOT NULL,
	`note` varchar(500) NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `ai_overrides_id` PRIMARY KEY(`id`),
	CONSTRAINT `ai_override_entity` UNIQUE(`entity_type`,`entity_id`,`task`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `ai_results` (
	`id` int AUTO_INCREMENT NOT NULL,
	`task` varchar(32) NOT NULL,
	`entity_type` varchar(16) NOT NULL,
	`entity_id` int NOT NULL,
	`cache_key` char(64) NOT NULL,
	`input_hash` char(64) NOT NULL,
	`coverage` varchar(32) NOT NULL,
	`status` varchar(16) NOT NULL,
	`result_json` json,
	`model_alias` varchar(64) NOT NULL,
	`actual_model` varchar(180),
	`policy` varchar(64) NOT NULL,
	`normalization_version` varchar(32) NOT NULL,
	`attempts` int NOT NULL DEFAULT 0,
	`next_attempt_at` datetime,
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `ai_results_id` PRIMARY KEY(`id`),
	CONSTRAINT `ai_cache_key` UNIQUE(`cache_key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `topic_current` (
	`source` varchar(100) NOT NULL,
	`snapshot_id` char(36) NOT NULL,
	CONSTRAINT `topic_current_source` PRIMARY KEY(`source`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `topic_matches` (
	`post_id` int NOT NULL,
	`term_id` char(64) NOT NULL,
	`snapshot_id` char(36) NOT NULL,
	`source` varchar(16) NOT NULL,
	CONSTRAINT `topic_matches_post_id_term_id_source_pk` PRIMARY KEY(`post_id`,`term_id`,`source`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `topic_post_indexes` (
	`post_id` int NOT NULL,
	`snapshot_id` char(36) NOT NULL,
	`input_hash` char(64) NOT NULL,
	`post_hash` char(64),
	`body_hash` char(64),
	`matched_at` datetime NOT NULL,
	CONSTRAINT `topic_post_indexes_post_id` PRIMARY KEY(`post_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `topic_snapshots` (
	`id` char(36) NOT NULL,
	`manifest` json NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'staging',
	`generated_at` datetime NOT NULL,
	`synced_at` datetime,
	CONSTRAINT `topic_snapshots_id` PRIMARY KEY(`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `topic_terms` (
	`snapshot_id` char(36) NOT NULL,
	`id` char(64) NOT NULL,
	`label` varchar(255) NOT NULL,
	`normalized_label` varchar(255) NOT NULL,
	`payload` json NOT NULL,
	CONSTRAINT `topic_terms_snapshot_id_id_pk` PRIMARY KEY(`snapshot_id`,`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `topic_window_articles` (
	`run_id` char(36) NOT NULL,
	`article_id` varchar(24) NOT NULL,
	`payload` json NOT NULL,
	CONSTRAINT `topic_window_articles_run_id_article_id_pk` PRIMARY KEY(`run_id`,`article_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `topic_window_runs` (
	`id` char(36) NOT NULL,
	`since_at` varchar(30) NOT NULL,
	`until_at` varchar(30) NOT NULL,
	`cursor` varchar(64),
	`pages` int NOT NULL DEFAULT 0,
	`status` varchar(16) NOT NULL DEFAULT 'scanning',
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `topic_window_runs_id` PRIMARY KEY(`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE INDEX `relation_links_target` ON `relation_links` (`target_blog_id`);--> statement-breakpoint
CREATE INDEX `relation_links_source` ON `relation_links` (`source_blog_id`,`location`);--> statement-breakpoint
CREATE INDEX `relation_links_unresolved` ON `relation_links` (`target_blog_id`,`source_post_id`);--> statement-breakpoint
CREATE INDEX `relation_observations_due` ON `relation_observations` (`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `relation_observations_blog` ON `relation_observations` (`blog_id`);--> statement-breakpoint
CREATE INDEX `ai_entity` ON `ai_results` (`entity_type`,`entity_id`,`task`);--> statement-breakpoint
CREATE INDEX `topic_matches_term` ON `topic_matches` (`snapshot_id`,`term_id`);--> statement-breakpoint
CREATE INDEX `topic_indexes_version` ON `topic_post_indexes` (`snapshot_id`);--> statement-breakpoint
CREATE INDEX `topic_terms_label` ON `topic_terms` (`snapshot_id`,`normalized_label`);