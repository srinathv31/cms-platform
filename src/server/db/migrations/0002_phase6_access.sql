ALTER TABLE `memberships` ADD `status_reason` text;--> statement-breakpoint
ALTER TABLE `memberships` ADD `inactivity_flagged_at` integer;--> statement-breakpoint
ALTER TABLE `memberships` ADD `inactivity_kept_at` integer;--> statement-breakpoint
CREATE INDEX `access_requests_team_status` ON `access_requests` (`team_id`,`status`);--> statement-breakpoint
CREATE INDEX `access_requests_user` ON `access_requests` (`user_id`);