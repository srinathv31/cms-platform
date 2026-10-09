ALTER TABLE `approvals` ADD `stage_id` text;--> statement-breakpoint
ALTER TABLE `versions` ADD `stages` text;--> statement-breakpoint
-- Backfill (decision 0015): every submitted version records the stages it goes through. Nothing recorded
-- which chain a version was submitted under, so each gets its content type's chain as it is today, by id
-- and name in position order (Release 1's "Team approver" when the type has no stages). Drafts stay null.
UPDATE `versions`
SET `stages` = CASE
  WHEN EXISTS (
    SELECT 1 FROM `approval_stages` AS `s` JOIN `templates` AS `t` ON `t`.`content_type_id` = `s`.`content_type_id`
    WHERE `t`.`id` = `versions`.`template_id`
  ) THEN (
    SELECT json_group_array(json_object('id', `id`, 'name', `name`))
    FROM (
      SELECT `s`.`id`, `s`.`name`
      FROM `approval_stages` AS `s` JOIN `templates` AS `t` ON `t`.`content_type_id` = `s`.`content_type_id`
      WHERE `t`.`id` = `versions`.`template_id`
      ORDER BY `s`.`position`
    )
  )
  ELSE json_array(json_object('id', 'default', 'name', 'Team approver'))
END
WHERE `number` IS NOT NULL;--> statement-breakpoint
-- `current_stage` becomes a position in the version's own stages. A position past the end (a chain
-- shortened mid-review) was read as the last stage, so it becomes the last.
UPDATE `versions`
SET `current_stage` = MIN(MAX(`current_stage`, 0), json_array_length(`stages`) - 1)
WHERE `stages` IS NOT NULL;--> statement-breakpoint
-- Each decision's stage: the stage at its recorded position in the version's stages, that is, in today's
-- chain. Best effort: a decision made before the chain was reordered maps to whatever stage holds that
-- position now, and one at a position today's chain doesn't have stays null.
UPDATE `approvals`
SET `stage_id` = (
  SELECT json_extract(`v`.`stages`, '$[' || `approvals`.`stage_position` || '].id')
  FROM `versions` AS `v`
  WHERE `v`.`id` = `approvals`.`version_id`
);
