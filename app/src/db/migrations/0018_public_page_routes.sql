CREATE TABLE `public_page_routes` (
	`kind` varchar(16) NOT NULL,
	`entity_id` varchar(64) NOT NULL,
	`canonical_key` varchar(180) NOT NULL,
	`created_at` datetime NOT NULL,
	CONSTRAINT `public_page_routes_kind_entity_id_pk` PRIMARY KEY(`kind`,`entity_id`),
	CONSTRAINT `public_page_canonical` UNIQUE(`kind`,`canonical_key`)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
--> statement-breakpoint
CREATE TABLE `public_route_keys` (
	`kind` varchar(16) NOT NULL,
	`route_key` varchar(180) NOT NULL,
	`entity_id` varchar(64) NOT NULL,
	`created_at` datetime NOT NULL,
	CONSTRAINT `public_route_keys_kind_route_key_pk` PRIMARY KEY(`kind`,`route_key`),
	CONSTRAINT `public_route_key_owner` UNIQUE(`kind`,`route_key`,`entity_id`)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
--> statement-breakpoint
ALTER TABLE `public_page_routes` ADD CONSTRAINT `public_page_key_owner_fk` FOREIGN KEY (`kind`,`canonical_key`,`entity_id`) REFERENCES `public_route_keys`(`kind`,`route_key`,`entity_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `public_route_keys_entity` ON `public_route_keys` (`kind`,`entity_id`);