CREATE TABLE `history_runs` (
	`blog_id` int NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'partial',
	`pages_fetched` int NOT NULL DEFAULT 0,
	`articles_written` int NOT NULL DEFAULT 0,
	`tasks_total` int NOT NULL DEFAULT 0,
	`tasks_done` int NOT NULL DEFAULT 0,
	`archive_seen` boolean NOT NULL DEFAULT false,
	`warnings` json NOT NULL,
	`last_error` varchar(255),
	`next_attempt_at` datetime,
	`started_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	`completed_at` datetime,
	CONSTRAINT `history_runs_blog_id` PRIMARY KEY(`blog_id`)
);
--> statement-breakpoint
CREATE TABLE `history_tasks` (
	`id` char(64) NOT NULL,
	`blog_id` int NOT NULL,
	`url` varchar(1024) NOT NULL,
	`kind` varchar(16) NOT NULL,
	`source_url` varchar(1024) NOT NULL,
	`source_type` varchar(16) NOT NULL,
	`depth` int NOT NULL DEFAULT 0,
	`payload` json NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'pending',
	`attempts` int NOT NULL DEFAULT 0,
	`last_error` varchar(255),
	`response_hash` char(64),
	`created_at` datetime NOT NULL,
	`completed_at` datetime,
	CONSTRAINT `history_tasks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `history_runs_schedule` ON `history_runs` (`status`,`next_attempt_at`,`updated_at`);--> statement-breakpoint
CREATE INDEX `history_tasks_pending` ON `history_tasks` (`blog_id`,`status`,`kind`);--> statement-breakpoint
CREATE INDEX `history_tasks_response` ON `history_tasks` (`blog_id`,`response_hash`);--> statement-breakpoint
CREATE INDEX `posts_blog_url_prefix` ON `posts` (`blog_id`,`url`(512));