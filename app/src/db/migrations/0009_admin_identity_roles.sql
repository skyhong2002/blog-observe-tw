CREATE TABLE `admin_audits` (
	`id` int AUTO_INCREMENT NOT NULL,
	`actor_user_id` int,
	`action` varchar(64) NOT NULL,
	`entity_type` varchar(32) NOT NULL,
	`entity_id` varchar(191) NOT NULL,
	`before_json` json,
	`after_json` json,
	`note` varchar(500),
	`created_at` datetime NOT NULL,
	CONSTRAINT `admin_audits_id` PRIMARY KEY(`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `admin_google_identities` (
	`id` int AUTO_INCREMENT NOT NULL,
	`email` varchar(255) NOT NULL,
	`google_sub` varchar(255) NOT NULL,
	`user_id` int NOT NULL,
	`created_at` datetime NOT NULL,
	CONSTRAINT `admin_google_identities_id` PRIMARY KEY(`id`),
	CONSTRAINT `admin_pin_email` UNIQUE(`email`),
	CONSTRAINT `admin_pin_sub` UNIQUE(`google_sub`),
	CONSTRAINT `admin_pin_user` UNIQUE(`user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `admin_intents` (
	`id` char(64) NOT NULL,
	`actor_user_id` int NOT NULL,
	`action` varchar(64) NOT NULL,
	`payload_hash` char(64) NOT NULL,
	`status` varchar(16) NOT NULL,
	`result_json` json,
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `admin_intents_id` PRIMARY KEY(`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `admin_relation_overrides` (
	`fingerprint` char(64) NOT NULL,
	`source_post_id` int NOT NULL,
	`target_url_hash` char(64) NOT NULL,
	`target_url` varchar(2048) NOT NULL,
	`location` varchar(16) NOT NULL,
	`hidden` boolean NOT NULL,
	`reason` varchar(500) NOT NULL,
	`actor_user_id` int NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `admin_relation_overrides_fingerprint` PRIMARY KEY(`fingerprint`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
--> statement-breakpoint
ALTER TABLE `users` ADD `role` varchar(16) DEFAULT 'reader' NOT NULL;--> statement-breakpoint
CREATE INDEX `admin_audit_time` ON `admin_audits` (`created_at`);--> statement-breakpoint
CREATE INDEX `admin_relation_source` ON `admin_relation_overrides` (`source_post_id`,`target_url_hash`,`location`);