-- Verification TXT files for domain ownership checks (e.g. Google Search Console)
-- Dynamically served by the Worker from D1 when the request pathname matches.

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `verification_files` (
	`id` integer PRIMARY KEY NOT NULL,
	`path` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);

--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `verification_files_path_unique` ON `verification_files` (`path`);

--> statement-breakpoint
UPDATE `info` SET `value` = '11' WHERE `key` = 'migration_version';
