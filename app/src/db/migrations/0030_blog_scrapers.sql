CREATE TABLE `blog_scrapers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`blog_id` int,
	`candidate_id` int,
	`revision` int NOT NULL DEFAULT 1,
	`status` varchar(16) NOT NULL,
	`trigger` varchar(32) NOT NULL,
	`code` mediumtext NOT NULL,
	`code_sha256` char(64) NOT NULL,
	`list_urls` json NOT NULL,
	`max_pages` int NOT NULL DEFAULT 1,
	`model` varchar(64) NOT NULL,
	`actual_model` varchar(180),
	`validation` json,
	`created_at` datetime NOT NULL,
	`activated_at` datetime,
	`last_run_at` datetime,
	`last_success_at` datetime,
	`last_error_at` datetime,
	`consecutive_failures` int NOT NULL DEFAULT 0,
	`last_error` varchar(255),
	CONSTRAINT `blog_scrapers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `scraper_generation_attempts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`target_type` varchar(16) NOT NULL,
	`target_id` int NOT NULL,
	`trigger` varchar(32) NOT NULL,
	`status` varchar(16) NOT NULL,
	`reason` varchar(255),
	`rounds` int NOT NULL DEFAULT 0,
	`scraper_id` int,
	`actual_model` varchar(180),
	`report` json,
	`created_at` datetime NOT NULL,
	CONSTRAINT `scraper_generation_attempts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `blog_scrapers_blog` ON `blog_scrapers` (`blog_id`,`status`);--> statement-breakpoint
CREATE INDEX `blog_scrapers_candidate` ON `blog_scrapers` (`candidate_id`);--> statement-breakpoint
CREATE INDEX `scraper_attempts_target` ON `scraper_generation_attempts` (`target_type`,`target_id`,`created_at`);