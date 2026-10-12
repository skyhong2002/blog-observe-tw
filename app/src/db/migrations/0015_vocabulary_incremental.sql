ALTER TABLE `topic_post_indexes_v2` ADD `needs_refresh` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `topic_window_articles` ADD `published_at` datetime;--> statement-breakpoint
ALTER TABLE `topic_window_runs` ADD `coverage_since` varchar(30);--> statement-breakpoint
ALTER TABLE `topic_window_runs` ADD `parent_run_id` char(36);--> statement-breakpoint
ALTER TABLE `topic_window_runs` ADD `sync_strategy` varchar(32) DEFAULT 'full-window' NOT NULL;--> statement-breakpoint
CREATE INDEX `topic_window_articles_time` ON `topic_window_articles` (`run_id`,`published_at`);