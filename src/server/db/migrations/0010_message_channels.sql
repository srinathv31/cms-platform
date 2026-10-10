-- The message channels, Push and SMS (decisions 0034 and 0035). A content type gets an SMS footer (brand and
-- opt-out, printed on its own line after every SMS of that type; null: none) and a part budget submit holds
-- an SMS to with the long sample values (3 unless set). A team gets the app name over its push notifications
-- and the short code its SMS come from, both null until set. Existing rows keep working as they are: a
-- document content type has no footer, and its budget is never read.
ALTER TABLE `content_types` ADD `sms_footer` text;--> statement-breakpoint
ALTER TABLE `content_types` ADD `sms_max_parts` integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE `teams` ADD `app_name` text;--> statement-breakpoint
ALTER TABLE `teams` ADD `sms_sender` text;
