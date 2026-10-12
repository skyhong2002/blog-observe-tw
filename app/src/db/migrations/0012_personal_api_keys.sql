CREATE TABLE `user_api_keys` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`key_hash` char(64) NOT NULL,
	`prefix` varchar(16) NOT NULL,
	`label` varchar(80) NOT NULL DEFAULT '',
	`created_at` datetime NOT NULL,
	`last_used_at` datetime,
	`revoked_at` datetime,
	CONSTRAINT `user_api_keys_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_api_keys_hash` UNIQUE(`key_hash`)
);
--> statement-breakpoint
CREATE INDEX `user_api_keys_user_active` ON `user_api_keys` (`user_id`,`revoked_at`);