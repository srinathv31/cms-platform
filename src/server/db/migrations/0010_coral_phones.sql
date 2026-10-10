-- Coral delivers alerts: push and SMS reach its customers' phones (decision 0033). Coral's own tables only.
-- sim_offers: a row is an offer or an alert (`kind`, every existing row an offer), and an alert has no
-- terms, so `terms` becomes nullable. sim_customers: each customer has a phone (a fictional number in the
-- 555-01xx range and a platform, iPhone or Android), a card and, for the alerts' values, the card's
-- statement and last purchase. sim_deliveries: a push records the platform Coral asked Stencil for.
-- SQLite can't add NOT NULL columns without a default to a table that has rows, or drop a NOT NULL, so
-- both tables are rebuilt (the migrator runs with foreign keys off, so sim_links keeps its rows). Existing
-- customers are numbered in id order: +1 201 555-0101, -0102, …, iPhone and Android in turn, and a card
-- number from the same count; their statement and last purchase stay null.
CREATE TABLE `__new_sim_offers` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text DEFAULT 'offer' NOT NULL,
	`name` text NOT NULL,
	`headline` text NOT NULL,
	`terms` text
);
--> statement-breakpoint
INSERT INTO `__new_sim_offers` (`id`, `kind`, `name`, `headline`, `terms`)
SELECT `id`, 'offer', `name`, `headline`, `terms` FROM `sim_offers`;
--> statement-breakpoint
DROP TABLE `sim_offers`;--> statement-breakpoint
ALTER TABLE `__new_sim_offers` RENAME TO `sim_offers`;--> statement-breakpoint
CREATE TABLE `__new_sim_customers` (
	`id` text PRIMARY KEY NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`email` text NOT NULL,
	`home_state` text NOT NULL,
	`purchase_apr` text NOT NULL,
	`annual_fee` text,
	`phone` text NOT NULL,
	`platform` text NOT NULL,
	`card_last4` text NOT NULL,
	`statement` text,
	`last_purchase` text
);
--> statement-breakpoint
INSERT INTO `__new_sim_customers` (`id`, `first_name`, `last_name`, `email`, `home_state`, `purchase_apr`, `annual_fee`, `phone`, `platform`, `card_last4`, `statement`, `last_purchase`)
SELECT `id`, `first_name`, `last_name`, `email`, `home_state`, `purchase_apr`, `annual_fee`,
	'+1201555' || printf('%04d', 100 + `n`),
	CASE `n` % 2 WHEN 1 THEN 'ios' ELSE 'android' END,
	printf('%04d', (`n` * 3917) % 10000),
	NULL,
	NULL
FROM (SELECT *, ROW_NUMBER() OVER (ORDER BY `id`) AS `n` FROM `sim_customers`);
--> statement-breakpoint
DROP TABLE `sim_customers`;--> statement-breakpoint
ALTER TABLE `__new_sim_customers` RENAME TO `sim_customers`;--> statement-breakpoint
ALTER TABLE `sim_deliveries` ADD `platform` text;
