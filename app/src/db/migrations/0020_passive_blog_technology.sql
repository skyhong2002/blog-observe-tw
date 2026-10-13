CREATE TABLE `blog_tech_scans` (
	`blog_id` int NOT NULL,
	`status` varchar(16) NOT NULL,
	`detections` json NOT NULL,
	`source_url` varchar(1024),
	`source_type` varchar(24),
	`source_post_id` int,
	`coverage` json,
	`rule_version` varchar(64) NOT NULL,
	`observed_at` datetime(3),
	`last_attempt_at` datetime(3) NOT NULL,
	`last_attempt_source_url` varchar(1024),
	`last_attempt_source_post_id` int,
	`last_error_code` varchar(64),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `blog_tech_scans_blog_id` PRIMARY KEY(`blog_id`)
);
--> statement-breakpoint
CREATE INDEX `blog_tech_attempt` ON `blog_tech_scans` (`last_attempt_at`);--> statement-breakpoint
CREATE INDEX `blog_tech_source_post` ON `blog_tech_scans` (`source_post_id`);