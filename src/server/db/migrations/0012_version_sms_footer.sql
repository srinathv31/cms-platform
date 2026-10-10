-- A version keeps the SMS footer it was submitted with (decision 0035). The footer is the content type's (brand and
-- opt-out), and it used to be read at render time, so changing it changed the text of every Active alert without
-- approval. Now submit freezes it into the version, and render, review, Compare and Coral print the version's own.
-- A draft keeps null and shows the content type's footer as it stands. Every version already submitted (in review,
-- changes requested, active, superseded, revoked) takes its content type's footer as it is today, the one it has
-- been rendering with; a document's content type has none, so its versions stay null.
ALTER TABLE `versions` ADD `sms_footer` text;--> statement-breakpoint
UPDATE `versions` SET `sms_footer` = (
	SELECT `content_types`.`sms_footer`
	FROM `templates` INNER JOIN `content_types` ON `content_types`.`id` = `templates`.`content_type_id`
	WHERE `templates`.`id` = `versions`.`template_id`
) WHERE `state` <> 'draft';
