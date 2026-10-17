CREATE TABLE `search_usage_daily` (
	`day` char(10) NOT NULL,
	`site_searches` int NOT NULL DEFAULT 0,
	`site_later_pages` int NOT NULL DEFAULT 0,
	`with_results` int NOT NULL DEFAULT 0,
	`body_matches` int NOT NULL DEFAULT 0,
	`body_only` int NOT NULL DEFAULT 0,
	`site_failures` int NOT NULL DEFAULT 0,
	`api_requests` int NOT NULL DEFAULT 0,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `search_usage_daily_day` PRIMARY KEY(`day`)
);
