CREATE TABLE `blog_site_observations` (
	`blog_id` int NOT NULL,
	`homepage_url` varchar(1024) NOT NULL,
	`http_status` int,
	`author_name` varchar(255),
	`personal` boolean,
	`organization` boolean,
	`reason` varchar(64) NOT NULL,
	`identity_snippet` text,
	`observed_at` datetime NOT NULL,
	CONSTRAINT `blog_site_observations_blog_id` PRIMARY KEY(`blog_id`)
);
