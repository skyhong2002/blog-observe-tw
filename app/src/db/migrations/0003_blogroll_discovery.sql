CREATE TABLE `discovery_edges` (
	`edge_sha256` char(64) NOT NULL,
	`root_url` varchar(1024) NOT NULL,
	`source_url` varchar(1024) NOT NULL,
	`target_url` varchar(1024) NOT NULL,
	`path` json NOT NULL,
	`anchor_text` varchar(512) NOT NULL,
	`relation` varchar(32) NOT NULL,
	`body_sha256` char(64) NOT NULL,
	`first_seen_at` datetime NOT NULL,
	`last_seen_at` datetime NOT NULL,
	CONSTRAINT `discovery_edges_edge_sha256` PRIMARY KEY(`edge_sha256`)
);
--> statement-breakpoint
CREATE TABLE `discovery_pages` (
	`url_sha256` char(64) NOT NULL,
	`url` varchar(1024) NOT NULL,
	`final_url` varchar(1024) NOT NULL,
	`parser_version` int NOT NULL,
	`kind` varchar(32) NOT NULL,
	`etag` varchar(512),
	`last_modified` varchar(255),
	`body_sha256` char(64) NOT NULL,
	`links` json NOT NULL,
	`fetched_at` datetime NOT NULL,
	CONSTRAINT `discovery_pages_url_sha256` PRIMARY KEY(`url_sha256`)
);
--> statement-breakpoint
CREATE INDEX `discovery_edges_seen` ON `discovery_edges` (`last_seen_at`);--> statement-breakpoint
CREATE INDEX `discovery_pages_fetched` ON `discovery_pages` (`fetched_at`);