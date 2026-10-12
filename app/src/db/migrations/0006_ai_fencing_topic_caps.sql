ALTER TABLE `ai_results` ADD `claim_token` char(32);--> statement-breakpoint
ALTER TABLE `topic_post_indexes` ADD `status` varchar(16) DEFAULT 'ok' NOT NULL;