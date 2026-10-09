-- consumer_notices.seq: the commit order the notices API pages on. SQLite can't add a NOT NULL column
-- without a default to a table that has rows, so the table is rebuilt. Existing notices are numbered
-- 1, 2, 3, … oldest first (created_at, then id), the order the API served them in before, and the
-- last number goes in settings.consumer_notice_seq, the counter new notices continue from. On an
-- empty table (a fresh reset) there is no counter row yet; the seed writes it.
CREATE TABLE `__new_consumer_notices` (
	`id` text PRIMARY KEY NOT NULL,
	`seq` integer NOT NULL,
	`consumer_id` text NOT NULL,
	`template_id` text NOT NULL,
	`version_id` text NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`consumer_id`) REFERENCES `consumers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_consumer_notices` (`id`, `seq`, `consumer_id`, `template_id`, `version_id`, `kind`, `payload`, `created_at`)
SELECT `id`, ROW_NUMBER() OVER (ORDER BY `created_at`, `id`), `consumer_id`, `template_id`, `version_id`, `kind`, `payload`, `created_at`
FROM `consumer_notices`;
--> statement-breakpoint
DROP TABLE `consumer_notices`;--> statement-breakpoint
ALTER TABLE `__new_consumer_notices` RENAME TO `consumer_notices`;--> statement-breakpoint
CREATE UNIQUE INDEX `consumer_notices_seq` ON `consumer_notices` (`seq`);--> statement-breakpoint
CREATE INDEX `consumer_notices_consumer_seq` ON `consumer_notices` (`consumer_id`,`seq`);--> statement-breakpoint
INSERT INTO `settings` (`key`, `value`)
SELECT 'consumer_notice_seq', (SELECT MAX(`seq`) FROM `consumer_notices`)
WHERE EXISTS (SELECT 1 FROM `consumer_notices`)
ON CONFLICT (`key`) DO NOTHING;
