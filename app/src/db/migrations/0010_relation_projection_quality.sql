CREATE TABLE `relation_projection_state` (
	`id` int NOT NULL,
	`revision` int NOT NULL DEFAULT 0,
	CONSTRAINT `relation_projection_state_id` PRIMARY KEY(`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `relation_snapshots` (
	`days` int NOT NULL,
	`revision` int NOT NULL,
	`payload` json NOT NULL,
	`generated_at` datetime NOT NULL,
	CONSTRAINT `relation_snapshots_days` PRIMARY KEY(`days`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
--> statement-breakpoint
ALTER TABLE `relation_home_links` ADD `target_reason` varchar(64);--> statement-breakpoint
ALTER TABLE `relation_links` ADD `target_reason` varchar(64);--> statement-breakpoint
CREATE INDEX `relation_links_resolution_due` ON `relation_links` (`resolution_checked_at`,`source_post_id`);