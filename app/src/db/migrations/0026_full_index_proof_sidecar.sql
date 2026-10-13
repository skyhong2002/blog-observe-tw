CREATE TABLE `topic_generation_proof_contracts` (
	`snapshot_id` char(36) NOT NULL,
	`proof_version` varchar(64) NOT NULL,
	`fingerprint_version` varchar(64) NOT NULL,
	`manifest_sha256` char(64) NOT NULL,
	`policy_version` varchar(128) NOT NULL,
	`selection_id` char(64) NOT NULL,
	`matcher_version` varchar(128) NOT NULL,
	`cleanup_version` varchar(64) NOT NULL,
	`scan_contract_version` varchar(32) NOT NULL,
	`status` varchar(24) NOT NULL,
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `topic_generation_proof_contracts_snapshot_id` PRIMARY KEY(`snapshot_id`)
);
--> statement-breakpoint
CREATE TABLE `topic_index_proofs` (
	`snapshot_id` char(36) NOT NULL,
	`post_id` int NOT NULL,
	`scan_run_id` char(36) NOT NULL,
	`proof_version` varchar(64) NOT NULL,
	`fingerprint_version` varchar(64) NOT NULL,
	`policy_version` varchar(128) NOT NULL,
	`selection_id` char(64) NOT NULL,
	`matcher_version` varchar(128) NOT NULL,
	`cleanup_version` varchar(64) NOT NULL,
	`kind` varchar(16) NOT NULL,
	`metadata_fingerprint` char(64) NOT NULL,
	`body_fingerprint` char(64),
	`body_content_hash` char(64),
	`body_revision` int,
	`source_kind` varchar(32),
	`body_obtained_at` datetime,
	`observed_at` datetime NOT NULL,
	`checked_at` datetime NOT NULL,
	`input_hash` char(64) NOT NULL,
	CONSTRAINT `topic_index_proofs_snapshot_id_post_id_pk` PRIMARY KEY(`snapshot_id`,`post_id`)
);
--> statement-breakpoint
ALTER TABLE `topic_generation_proof_contracts` ADD CONSTRAINT `topic_proof_contract_snapshot_fk` FOREIGN KEY (`snapshot_id`) REFERENCES `topic_snapshots`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `topic_index_proofs` ADD CONSTRAINT `topic_index_proof_contract_fk` FOREIGN KEY (`snapshot_id`) REFERENCES `topic_generation_proof_contracts`(`snapshot_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `topic_index_proofs` ADD CONSTRAINT `topic_index_proof_run_fk` FOREIGN KEY (`scan_run_id`) REFERENCES `topic_staged_scan_runs`(`run_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `topic_index_proofs` ADD CONSTRAINT `topic_index_proof_index_fk` FOREIGN KEY (`snapshot_id`,`post_id`) REFERENCES `topic_post_indexes_v3`(`snapshot_id`,`post_id`) ON DELETE cascade ON UPDATE no action;
