-- Idempotent and resumable: MariaDB commits each CREATE INDEX on its own, so a failure after the first index
-- leaves it in place while this file stays unrecorded. A rerun skips an index that already exists, and only after its
-- definition is checked (same name, other columns/prefix/uniqueness/order fails the migration instead of passing).
-- Online build (INPLACE, LOCK=NONE); a held metadata lock fails the statement after 5 s, so readers queued behind it wait
-- at most that long (below the web's 10 s gateway read timeout) instead of indefinitely.
-- posts is not indexed here: its USING HASH unique key makes any added index ALGORITHM=COPY.
SET SESSION lock_wait_timeout=5;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `content_bodies_hash` ON `content_post_bodies` (`post_id`,`blog_id`,`status`,`content_hash`) ALGORITHM=INPLACE LOCK=NONE;--> statement-breakpoint
BEGIN NOT ATOMIC
  IF (SELECT COALESCE(GROUP_CONCAT(CONCAT(COLUMN_NAME,':',NON_UNIQUE,':',COALESCE(SUB_PART,'-'),':',INDEX_TYPE,':',COALESCE(COLLATION,'-'),':',IGNORED) ORDER BY SEQ_IN_INDEX SEPARATOR ','),'')
      FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='content_post_bodies' AND INDEX_NAME='content_bodies_hash')
      <> 'post_id:1:-:BTREE:A:NO,blog_id:1:-:BTREE:A:NO,status:1:-:BTREE:A:NO,content_hash:1:-:BTREE:A:NO' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='content_bodies_hash: existing index definition differs';
  END IF;
END;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `relation_observations_hash` ON `relation_observations` (`post_id`,`blog_id`,`status`,`content_hash`) ALGORITHM=INPLACE LOCK=NONE;--> statement-breakpoint
BEGIN NOT ATOMIC
  IF (SELECT COALESCE(GROUP_CONCAT(CONCAT(COLUMN_NAME,':',NON_UNIQUE,':',COALESCE(SUB_PART,'-'),':',INDEX_TYPE,':',COALESCE(COLLATION,'-'),':',IGNORED) ORDER BY SEQ_IN_INDEX SEPARATOR ','),'')
      FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='relation_observations' AND INDEX_NAME='relation_observations_hash')
      <> 'post_id:1:-:BTREE:A:NO,blog_id:1:-:BTREE:A:NO,status:1:-:BTREE:A:NO,content_hash:1:-:BTREE:A:NO' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='relation_observations_hash: existing index definition differs';
  END IF;
END
