CREATE TABLE `robots_observations` (
	`host` varchar(255) NOT NULL,
	`outcome` varchar(16) NOT NULL,
	`http_status` int,
	`error` varchar(32),
	`disallow` json,
	`checked_at` datetime NOT NULL,
	`readable_at` datetime,
	CONSTRAINT `robots_observations_host` PRIMARY KEY(`host`)
);
