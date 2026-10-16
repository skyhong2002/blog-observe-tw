CREATE INDEX `content_bodies_schedule` ON `content_post_bodies` (`post_id`,`adapter_version`,`source_kind`,`status`) ALGORITHM=INPLACE LOCK=NONE;
