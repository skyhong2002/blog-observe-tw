CREATE TABLE `authors` (
	`id` int AUTO_INCREMENT NOT NULL,
	`display_name` varchar(255) NOT NULL,
	`normalized_name` varchar(255),
	`bio` text,
	`homepage_url` varchar(1024),
	`status` varchar(32) NOT NULL DEFAULT 'candidate',
	`claim_status` varchar(32) NOT NULL DEFAULT 'unclaimed',
	`merge_status` varchar(32) NOT NULL DEFAULT 'separate',
	`merged_into_id` int,
	`source_type` varchar(32) NOT NULL DEFAULT 'crawler',
	`source_actor_id` int,
	`source_url` varchar(1024),
	`source_evidence` json,
	`first_seen_at` datetime NOT NULL,
	`last_seen_at` datetime NOT NULL,
	`last_published_at` datetime,
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `authors_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `blog_authors` (
	`blog_id` int NOT NULL,
	`author_id` int NOT NULL,
	`role` varchar(32) NOT NULL DEFAULT 'author',
	`status` varchar(32) NOT NULL DEFAULT 'candidate',
	`is_primary` boolean NOT NULL DEFAULT false,
	`source_type` varchar(32) NOT NULL DEFAULT 'crawler',
	`source_actor_id` int,
	`source_url` varchar(1024),
	`source_evidence` json,
	`first_seen_at` datetime NOT NULL,
	`last_seen_at` datetime NOT NULL,
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `blog_authors_blog_id_author_id_pk` PRIMARY KEY(`blog_id`,`author_id`)
);
--> statement-breakpoint
CREATE TABLE `blog_tags` (
	`blog_id` int NOT NULL,
	`tag_id` int NOT NULL,
	`role` varchar(32) NOT NULL DEFAULT 'identity',
	`status` varchar(32) NOT NULL DEFAULT 'candidate',
	`source_type` varchar(32) NOT NULL DEFAULT 'crawler',
	`source_actor_id` int,
	`source_url` varchar(1024),
	`source_evidence` json,
	`first_seen_at` datetime NOT NULL,
	`last_seen_at` datetime NOT NULL,
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `blog_tags_blog_id_tag_id_pk` PRIMARY KEY(`blog_id`,`tag_id`)
);
--> statement-breakpoint
CREATE TABLE `discovery_candidate_audits` (
	`id` int AUTO_INCREMENT NOT NULL,
	`candidate_id` int NOT NULL,
	`action` varchar(32) NOT NULL,
	`previous_status` varchar(32),
	`next_status` varchar(32),
	`source_type` varchar(32) NOT NULL DEFAULT 'manual',
	`source_actor_id` int,
	`source_url` varchar(1024),
	`source_evidence` json,
	`note` text,
	`occurred_at` datetime NOT NULL,
	`created_at` datetime NOT NULL,
	CONSTRAINT `discovery_candidate_audits_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `post_authors` (
	`post_id` int NOT NULL,
	`author_id` int NOT NULL,
	`role` varchar(32) NOT NULL DEFAULT 'author',
	`position` int NOT NULL DEFAULT 0,
	`status` varchar(32) NOT NULL DEFAULT 'active',
	`source_type` varchar(32) NOT NULL DEFAULT 'crawler',
	`source_actor_id` int,
	`source_url` varchar(1024),
	`source_evidence` json,
	`first_seen_at` datetime NOT NULL,
	`last_seen_at` datetime NOT NULL,
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `post_authors_post_id_author_id_pk` PRIMARY KEY(`post_id`,`author_id`)
);
--> statement-breakpoint
CREATE TABLE `post_tags` (
	`post_id` int NOT NULL,
	`tag_id` int NOT NULL,
	`role` varchar(32) NOT NULL DEFAULT 'topic',
	`position` int NOT NULL DEFAULT 0,
	`status` varchar(32) NOT NULL DEFAULT 'active',
	`source_type` varchar(32) NOT NULL DEFAULT 'crawler',
	`source_actor_id` int,
	`source_url` varchar(1024),
	`source_evidence` json,
	`first_seen_at` datetime NOT NULL,
	`last_seen_at` datetime NOT NULL,
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `post_tags_post_id_tag_id_pk` PRIMARY KEY(`post_id`,`tag_id`)
);
--> statement-breakpoint
CREATE TABLE `tags` (
	`id` int AUTO_INCREMENT NOT NULL,
	`slug` varchar(180) NOT NULL,
	`label` varchar(255) NOT NULL,
	`normalized_label` varchar(255),
	`kind` varchar(32) NOT NULL DEFAULT 'topic',
	`visibility` varchar(32) NOT NULL DEFAULT 'public',
	`status` varchar(32) NOT NULL DEFAULT 'candidate',
	`canonical_tag_id` int,
	`source_type` varchar(32) NOT NULL DEFAULT 'crawler',
	`source_actor_id` int,
	`source_url` varchar(1024),
	`source_evidence` json,
	`first_seen_at` datetime NOT NULL,
	`last_seen_at` datetime NOT NULL,
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `tags_id` PRIMARY KEY(`id`),
	CONSTRAINT `tags_slug` UNIQUE(`slug`)
);
--> statement-breakpoint
ALTER TABLE `blogs` ADD `last_crawl_success_at` datetime;--> statement-breakpoint
ALTER TABLE `blogs` ADD `history_imported_at` datetime;--> statement-breakpoint
ALTER TABLE `blogs` ADD `stale_policy` varchar(32) DEFAULT 'low_frequency' NOT NULL;--> statement-breakpoint
CREATE INDEX `authors_normalized_name` ON `authors` (`normalized_name`);--> statement-breakpoint
CREATE INDEX `authors_status` ON `authors` (`status`);--> statement-breakpoint
CREATE INDEX `authors_claim_merge` ON `authors` (`claim_status`,`merge_status`);--> statement-breakpoint
CREATE INDEX `blog_authors_author_status` ON `blog_authors` (`author_id`,`status`);--> statement-breakpoint
CREATE INDEX `blog_authors_blog_status` ON `blog_authors` (`blog_id`,`status`);--> statement-breakpoint
CREATE INDEX `blog_tags_tag_status` ON `blog_tags` (`tag_id`,`status`);--> statement-breakpoint
CREATE INDEX `blog_tags_blog_status` ON `blog_tags` (`blog_id`,`status`);--> statement-breakpoint
CREATE INDEX `discovery_candidate_audits_candidate_time` ON `discovery_candidate_audits` (`candidate_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `discovery_candidate_audits_action_time` ON `discovery_candidate_audits` (`action`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `discovery_candidate_audits_source_time` ON `discovery_candidate_audits` (`source_type`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `post_authors_author` ON `post_authors` (`author_id`,`status`);--> statement-breakpoint
CREATE INDEX `post_authors_post_position` ON `post_authors` (`post_id`,`position`);--> statement-breakpoint
CREATE INDEX `post_tags_tag_status` ON `post_tags` (`tag_id`,`status`);--> statement-breakpoint
CREATE INDEX `post_tags_post_position` ON `post_tags` (`post_id`,`position`);--> statement-breakpoint
CREATE INDEX `tags_normalized_label` ON `tags` (`normalized_label`);--> statement-breakpoint
CREATE INDEX `tags_kind_status` ON `tags` (`kind`,`status`);--> statement-breakpoint
CREATE INDEX `tags_canonical` ON `tags` (`canonical_tag_id`);