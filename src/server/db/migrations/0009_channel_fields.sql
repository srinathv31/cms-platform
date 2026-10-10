-- versions.channel_fields: each channel's own short fields in one JSON column, keyed by channel and then
-- by field key (src/domain/channel-fields.ts), in place of a column per field. Email's subject and
-- preheader move into it as they are, `{"email":{"subject":<doc>,"preheader":<doc>}}`, leaving out a field
-- that has no value (and the email key when neither has one), so a version without any holds `{}`. Then
-- the two email columns go: nothing reads them any more.
ALTER TABLE `versions` ADD `channel_fields` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
UPDATE `versions`
SET `channel_fields` = json_object('email', json_patch(
	CASE WHEN `email_subject` IS NULL THEN '{}' ELSE json_object('subject', json(`email_subject`)) END,
	CASE WHEN `email_preheader` IS NULL THEN '{}' ELSE json_object('preheader', json(`email_preheader`)) END
))
WHERE `email_subject` IS NOT NULL OR `email_preheader` IS NOT NULL;--> statement-breakpoint
ALTER TABLE `versions` DROP COLUMN `email_subject`;--> statement-breakpoint
ALTER TABLE `versions` DROP COLUMN `email_preheader`;
