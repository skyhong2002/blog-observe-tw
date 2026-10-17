CREATE TABLE `blog_genre_assignments` (
	`blog_id` int NOT NULL,
	`genre` varchar(32) NOT NULL,
	`source` varchar(16) NOT NULL,
	`status` varchar(16) NOT NULL,
	`reason` text,
	`actor_user_id` int,
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `blog_genre_assignments_blog_id_genre_source_pk` PRIMARY KEY(`blog_id`,`genre`,`source`)
);
--> statement-breakpoint
CREATE TABLE `blog_genre_votes` (
	`blog_id` int NOT NULL,
	`genre` varchar(32) NOT NULL,
	`user_id` int NOT NULL,
	`vote` int NOT NULL,
	`at` datetime NOT NULL,
	CONSTRAINT `blog_genre_votes_blog_id_genre_user_id_pk` PRIMARY KEY(`blog_id`,`genre`,`user_id`),
	CONSTRAINT `blog_genre_vote_value` CHECK (`vote` IN (-1, 1))
);
--> statement-breakpoint
CREATE INDEX `blog_genre_vote_counts` ON `blog_genre_votes` (`blog_id`,`genre`,`vote`);
