CREATE TABLE `similarweb_control` (
	`id` varchar(32) NOT NULL,
	`budget_day` char(10) NOT NULL,
	`submitted_count` int NOT NULL DEFAULT 0,
	`next_round_at` datetime NOT NULL,
	`cooldown_until` datetime,
	CONSTRAINT `similarweb_control_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `similarweb_domains` (
	`domain` varchar(253) NOT NULL,
	`submitted_kinds` json NOT NULL,
	`last_submitted_at` datetime,
	`last_polled_at` datetime,
	`next_poll_at` datetime NOT NULL,
	`last_result_fetched_at` datetime,
	`result` json,
	`last_applied_fingerprint` char(64),
	`last_error_code` varchar(64),
	`updated_at` datetime NOT NULL,
	CONSTRAINT `similarweb_domains_domain` PRIMARY KEY(`domain`)
);
--> statement-breakpoint
CREATE INDEX `similarweb_domains_poll` ON `similarweb_domains` (`next_poll_at`);