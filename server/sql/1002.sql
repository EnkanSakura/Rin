-- Bangumi (追番) daily snapshot cache.
-- Holds one row per Bangumi user id: the full user collection payload as JSON
-- text plus its sync time. The row is written by the scheduled task when the
-- client config "bangumi.updateMode" is "auto", and read by GET /api/bangumi.
--
-- NOTE: numbered 1002 (after the 1000 baseline, see 1001.sql).

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `bangumi_cache` (
	`user_id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);

--> statement-breakpoint
UPDATE `info` SET `value` = '1002' WHERE `key` = 'migration_version';
