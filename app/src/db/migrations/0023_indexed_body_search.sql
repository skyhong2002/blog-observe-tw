CREATE TABLE `post_body_search_terms` (
	`gram_hash` char(64) NOT NULL,
	`post_id` int NOT NULL,
	`content_hash` char(64) NOT NULL,
	`body_text_hash` char(64) NOT NULL,
	`prefix_characters` int NOT NULL,
	`prefix_truncated` boolean NOT NULL,
	`index_version` varchar(64) NOT NULL,
	CONSTRAINT `post_body_search_terms_gram_hash_post_id_pk` PRIMARY KEY(`gram_hash`,`post_id`)
);
--> statement-breakpoint
CREATE INDEX `body_search_post` ON `post_body_search_terms` (`post_id`);