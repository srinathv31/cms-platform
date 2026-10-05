ALTER TABLE `sim_deliveries` ADD `template_id` text;--> statement-breakpoint
ALTER TABLE `sim_deliveries` ADD `version_number` integer;--> statement-breakpoint
ALTER TABLE `sim_deliveries` ADD `newer_version` integer;--> statement-breakpoint
CREATE INDEX `sim_deliveries_offer_at` ON `sim_deliveries` (`offer_id`,`at`);--> statement-breakpoint
CREATE INDEX `sim_deliveries_batch` ON `sim_deliveries` (`batch_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sim_links_offer` ON `sim_links` (`offer_id`);