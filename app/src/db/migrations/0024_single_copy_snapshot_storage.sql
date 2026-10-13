ALTER TABLE `topic_terms` ADD `import_page_index` int;
--> statement-breakpoint
CREATE INDEX `topic_terms_import_page` ON `topic_terms` (`snapshot_id`,`import_page_index`,`id`);
--> statement-breakpoint
ALTER TABLE `topic_snapshot_runs` ADD `payload_mode` varchar(24) DEFAULT 'legacy-dual' NOT NULL;
--> statement-breakpoint
ALTER TABLE `topic_snapshot_runs` ADD `receipt_bytes` bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `topic_snapshot_runs` ADD `checksum_checkpoint` json;
--> statement-breakpoint
ALTER TABLE `topic_snapshot_runs` ADD `checkpoint_last_label` varchar(255);
--> statement-breakpoint
ALTER TABLE `topic_snapshot_runs` ADD `validation_next_page` int DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `topic_snapshot_runs` ADD `validated_terms` int DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `topic_snapshot_runs` ADD `validated_bytes` bigint DEFAULT 0 NOT NULL;
