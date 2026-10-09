-- versions.name: the name moves from the template to its versions, so renaming a draft reaches
-- customers only when that version goes live. Every existing version takes its template's name, the
-- only one there was. SQLite can't add a NOT NULL column without a default to a table that has rows,
-- so the table is rebuilt (the migrator runs with foreign keys off, so the tables that reference
-- versions keep their rows). A version whose template is missing fails the NOT NULL rather than be
-- dropped. `writers` and `stages` are carried over as they are. Then the template's own name goes:
-- nothing reads it any more.
CREATE TABLE `__new_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`template_id` text NOT NULL,
	`number` integer,
	`state` text NOT NULL,
	`name` text NOT NULL,
	`based_on_version_id` text,
	`body` text NOT NULL,
	`email_subject` text,
	`email_preheader` text,
	`channels` text NOT NULL,
	`variables` text NOT NULL,
	`sample_sets` text NOT NULL,
	`contract_changes` text,
	`current_stage` integer DEFAULT 0 NOT NULL,
	`rev` integer DEFAULT 0 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`submitted_by` text,
	`submitted_at` integer,
	`submit_note` text,
	`activated_at` integer,
	`superseded_at` integer,
	`sunset_at` integer,
	`sunset_set_by` text,
	`revoke` text,
	`import_upload_id` text,
	`writers` text DEFAULT '[]' NOT NULL,
	`stages` text,
	FOREIGN KEY (`template_id`) REFERENCES `templates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`submitted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sunset_set_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_versions` (`id`, `template_id`, `number`, `state`, `name`, `based_on_version_id`, `body`, `email_subject`, `email_preheader`, `channels`, `variables`, `sample_sets`, `contract_changes`, `current_stage`, `rev`, `created_by`, `created_at`, `updated_at`, `submitted_by`, `submitted_at`, `submit_note`, `activated_at`, `superseded_at`, `sunset_at`, `sunset_set_by`, `revoke`, `import_upload_id`, `writers`, `stages`)
SELECT `id`, `template_id`, `number`, `state`, (SELECT `templates`.`name` FROM `templates` WHERE `templates`.`id` = `versions`.`template_id`), `based_on_version_id`, `body`, `email_subject`, `email_preheader`, `channels`, `variables`, `sample_sets`, `contract_changes`, `current_stage`, `rev`, `created_by`, `created_at`, `updated_at`, `submitted_by`, `submitted_at`, `submit_note`, `activated_at`, `superseded_at`, `sunset_at`, `sunset_set_by`, `revoke`, `import_upload_id`, `writers`, `stages`
FROM `versions`;
--> statement-breakpoint
DROP TABLE `versions`;--> statement-breakpoint
ALTER TABLE `__new_versions` RENAME TO `versions`;--> statement-breakpoint
CREATE INDEX `versions_template` ON `versions` (`template_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `versions_template_number` ON `versions` (`template_id`,`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `versions_one_draft` ON `versions` (`template_id`) WHERE state = 'draft';--> statement-breakpoint
CREATE UNIQUE INDEX `versions_one_active` ON `versions` (`template_id`) WHERE state = 'active';--> statement-breakpoint
ALTER TABLE `templates` DROP COLUMN `name`;
