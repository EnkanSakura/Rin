-- Showcase (展柜) feature: album-like groups with ordered image items.
-- Showcases hold the album groups; showcase_items hold the per-album entries
-- (title, ordered image URL list stored as JSON text, description).
--
-- NOTE: numbered 1001 (not 0013) on purpose: databases whose
-- migration_version already reached 1000 would never run a lower-numbered
-- file, so new migrations after the 1000 baseline must use >1000 numbers.

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `showcases` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `showcase_items` (
	`id` integer PRIMARY KEY NOT NULL,
	`showcase_id` integer NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`images` text DEFAULT '[]' NOT NULL,
	`desc` text DEFAULT '' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`showcase_id`) REFERENCES `showcases`(`id`) ON UPDATE no action ON DELETE cascade
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `showcases_sort_order_idx` ON `showcases` (`sort_order`);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `showcase_items_showcase_order_idx` ON `showcase_items` (`showcase_id`, `sort_order`);

--> statement-breakpoint
UPDATE `info` SET `value` = '1001' WHERE `key` = 'migration_version';
