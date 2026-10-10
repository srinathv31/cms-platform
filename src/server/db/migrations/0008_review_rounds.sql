-- versions.round: the version number counts releases, and each submission to review is a round of the
-- version it will become. A resubmission after a send-back is the next round of the same number, so one
-- number can have several rows: its sent-back rounds and the one in review or released. The round is null
-- while a draft, set at submit with the number, then frozen. (template_id, number) stops being unique;
-- (template_id, number, round) is, and a number has at most one released row (Active, Superseded or
-- Revoked). NULLs stay distinct, so drafts pass both indexes.
--
-- Existing rows keep their numbers: consumers have pinned them, and render_log and consumer notices hold
-- them. Every submitted row becomes round 1, so a database from before keeps the gaps its send-backs
-- left (v1 sent back, then v2); `npm run db:reset` seeds the new shape. No CHECK constraint ("round set
-- iff number set"): it would force a table rebuild, and the domain and the seed check already hold it.
DROP INDEX `versions_template_number`;--> statement-breakpoint
ALTER TABLE `versions` ADD `round` integer;--> statement-breakpoint
UPDATE `versions` SET `round` = 1 WHERE `number` IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `versions_template_number_round` ON `versions` (`template_id`,`number`,`round`);--> statement-breakpoint
CREATE UNIQUE INDEX `versions_one_released` ON `versions` (`template_id`,`number`) WHERE state IN ('active', 'superseded', 'revoked');
