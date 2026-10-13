CREATE TABLE `topic_shared_label_snapshots` (
	`label_hash` char(64) NOT NULL,
	`kind` varchar(16) NOT NULL,
	`exact_label` varchar(60) NOT NULL,
	`status` varchar(16) NOT NULL,
	`validated_dto` json,
	`fetched_at` datetime(3) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`source_contract_sha` char(40) NOT NULL,
	`payload_version` varchar(128),
	CONSTRAINT `topic_shared_label_snapshots_label_hash_kind_pk` PRIMARY KEY(`label_hash`,`kind`)
);
--> statement-breakpoint
CREATE INDEX `shared_label_expiry` ON `topic_shared_label_snapshots` (`expires_at`);