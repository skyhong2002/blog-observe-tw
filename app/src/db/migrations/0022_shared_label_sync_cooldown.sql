CREATE TABLE `shared_label_sync_control` (
	`scope` varchar(8) NOT NULL,
	`retry_after_epoch_ms` bigint NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `shared_label_sync_control_scope` PRIMARY KEY(`scope`)
);
