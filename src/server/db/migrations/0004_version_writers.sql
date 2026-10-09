ALTER TABLE `versions` ADD `writers` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
-- Backfill (maker-checker): each version's writers are, for it and every change-requested version its
-- draft was copied from in an unbroken line, the creator, the submitter and every `draft.edited` actor.
-- A draft copied from an Active (now perhaps Superseded or Revoked) version starts afresh.
WITH RECURSIVE `lineage`(`version_id`, `ancestor_id`) AS (
  SELECT `id`, `id` FROM `versions`
  UNION
  SELECT `lineage`.`version_id`, `base`.`id`
  FROM `lineage`
  JOIN `versions` AS `child` ON `child`.`id` = `lineage`.`ancestor_id`
  JOIN `versions` AS `base` ON `base`.`id` = `child`.`based_on_version_id` AND `base`.`state` = 'changes_requested'
),
`writer`(`version_id`, `user_id`, `at`) AS (
  SELECT `lineage`.`version_id`, `v`.`created_by`, `v`.`created_at`
  FROM `lineage` JOIN `versions` AS `v` ON `v`.`id` = `lineage`.`ancestor_id`
  UNION ALL
  SELECT `lineage`.`version_id`, `v`.`submitted_by`, `v`.`submitted_at`
  FROM `lineage` JOIN `versions` AS `v` ON `v`.`id` = `lineage`.`ancestor_id`
  WHERE `v`.`submitted_by` IS NOT NULL
  UNION ALL
  SELECT `lineage`.`version_id`, `e`.`actor_id`, `e`.`at`
  FROM `lineage` JOIN `audit_events` AS `e` ON `e`.`version_id` = `lineage`.`ancestor_id`
  WHERE `e`.`action` = 'draft.edited' AND `e`.`actor_id` IS NOT NULL
),
`first_write`(`version_id`, `user_id`, `at`) AS (
  SELECT `version_id`, `user_id`, MIN(`at`) FROM `writer` GROUP BY `version_id`, `user_id`
)
UPDATE `versions`
SET `writers` = (
  SELECT json_group_array(`user_id`)
  FROM (SELECT `user_id` FROM `first_write` WHERE `first_write`.`version_id` = `versions`.`id` ORDER BY `at`, `user_id`)
);
