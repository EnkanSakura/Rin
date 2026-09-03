-- Verification TXT files for domain ownership checks (e.g. Google Search Console)
-- Dynamically served by the Worker from D1 when the request pathname matches.
--
-- NOTE: "u"-prefixed migration files (u0001, u0002, ...) are manually numbered
-- follow-ups that run after every plain-numeric migration. The CLI maps their
-- sequence number to 10000 + N (u0001 -> 10001) so that migration_version
-- advances past them exactly once. Keep the DDL idempotent (IF NOT EXISTS) so
-- databases that already applied this file under its former numeric name are
-- not affected when it is re-run.

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
UPDATE `info` SET `value` = '1000' WHERE `key` = 'migration_version';
