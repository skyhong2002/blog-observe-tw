CREATE TABLE `post_search_documents` (
 `post_id` int NOT NULL PRIMARY KEY,
 `index_version` varchar(64) NOT NULL,
 `metadata_hash` char(64) NOT NULL,
 `body_hash` char(64),
 `tokens` mediumtext CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 `indexed_at` datetime NOT NULL,
 FULLTEXT INDEX `search_document_fulltext` (`tokens`),
 CONSTRAINT `search_document_post` FOREIGN KEY (`post_id`) REFERENCES `posts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB;
