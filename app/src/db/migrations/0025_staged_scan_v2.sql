CREATE TABLE `topic_staged_scan_runs` (
 `run_id` char(36) NOT NULL,
 `target_snapshot_id` char(36) NOT NULL,
 `status` varchar(24) NOT NULL,
 `state_json` json NOT NULL,
 `created_at` datetime NOT NULL,
 `updated_at` datetime NOT NULL,
 CONSTRAINT `topic_staged_scan_runs_run_id` PRIMARY KEY (`run_id`)
);
--> statement-breakpoint
CREATE INDEX `topic_staged_scan_target` ON `topic_staged_scan_runs` (`target_snapshot_id`,`status`);
--> statement-breakpoint
CREATE TABLE `topic_staged_scan_owner` (
 `source` varchar(128) NOT NULL,
 `run_id` char(36),
 CONSTRAINT `topic_staged_scan_owner_source` PRIMARY KEY (`source`)
);
