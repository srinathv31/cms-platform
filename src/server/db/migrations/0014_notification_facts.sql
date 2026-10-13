-- A notification stores what happened instead of a sentence and an app URL (decision 0055): its kind, the
-- kind's facts (names as they were) and a link descriptor that names its team by id, worded and linked by the
-- BFF when it reads the row. `body` keeps only a person's own words. `title` and `href` go.
--
-- A stored sentence can't be turned back into facts, so the rows written before go with the old columns: the
-- demo database is reseeded (`npm run db:reset`), and there are no real rows yet. SQLite can't add a NOT NULL
-- column without a default, so the table is rebuilt; nothing references it.
DROP INDEX `notifications_user`;--> statement-breakpoint
DROP TABLE `notifications`;--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`team_id` text,
	`kind` text NOT NULL,
	`facts` text NOT NULL,
	`link` text NOT NULL,
	`body` text,
	`created_at` integer NOT NULL,
	`read_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `notifications_user` ON `notifications` (`user_id`);
