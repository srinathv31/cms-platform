CREATE TABLE `access_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`team_id` text NOT NULL,
	`role` text NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`decided_by` text,
	`decided_at` integer,
	`decision_note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decided_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `approval_stages` (
	`id` text PRIMARY KEY NOT NULL,
	`content_type_id` text NOT NULL,
	`position` integer NOT NULL,
	`name` text NOT NULL,
	`approver_rule` text NOT NULL,
	FOREIGN KEY (`content_type_id`) REFERENCES `content_types`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`version_id` text NOT NULL,
	`stage_position` integer NOT NULL,
	`stage_name` text NOT NULL,
	`actor_id` text NOT NULL,
	`decision` text NOT NULL,
	`reason` text,
	`sample_sets_seen` text,
	`decided_at` integer NOT NULL,
	FOREIGN KEY (`version_id`) REFERENCES `versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`at` integer NOT NULL,
	`actor_id` text,
	`team_id` text,
	`template_id` text,
	`version_id` text,
	`action` text NOT NULL,
	`details` text,
	`session_key` text,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_at` ON `audit_events` (`at`);--> statement-breakpoint
CREATE INDEX `audit_team` ON `audit_events` (`team_id`);--> statement-breakpoint
CREATE TABLE `comment_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`template_id` text NOT NULL,
	`origin_version_id` text NOT NULL,
	`block_id` text NOT NULL,
	`quote` text,
	`status` text DEFAULT 'open' NOT NULL,
	`resolved_by` text,
	`resolved_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`template_id`) REFERENCES `templates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`origin_version_id`) REFERENCES `versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`resolved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `threads_template` ON `comment_threads` (`template_id`);--> statement-breakpoint
CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`author_id` text NOT NULL,
	`body` text NOT NULL,
	`kind` text DEFAULT 'comment' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `comment_threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `consumer_notices` (
	`id` text PRIMARY KEY NOT NULL,
	`consumer_id` text NOT NULL,
	`template_id` text NOT NULL,
	`version_id` text NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`consumer_id`) REFERENCES `consumers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `consumers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`client_name` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `content_types` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`required_sections` text NOT NULL,
	`allowed_channels` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_types_key_unique` ON `content_types` (`key`);--> statement-breakpoint
CREATE TABLE `membership_roles` (
	`membership_id` text NOT NULL,
	`role` text NOT NULL,
	PRIMARY KEY(`membership_id`, `role`),
	FOREIGN KEY (`membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`team_id` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`added_at` integer NOT NULL,
	`added_by` text,
	`status_changed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`added_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memberships_user_team` ON `memberships` (`user_id`,`team_id`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`team_id` text,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`href` text,
	`created_at` integer NOT NULL,
	`read_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `notifications_user` ON `notifications` (`user_id`);--> statement-breakpoint
CREATE TABLE `recert_items` (
	`recert_id` text NOT NULL,
	`user_id` text NOT NULL,
	`decision` text,
	`decided_by` text,
	`decided_at` integer,
	PRIMARY KEY(`recert_id`, `user_id`),
	FOREIGN KEY (`recert_id`) REFERENCES `recertifications`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decided_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `recertifications` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`label` text NOT NULL,
	`starts_at` integer NOT NULL,
	`due_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `render_log` (
	`id` text PRIMARY KEY NOT NULL,
	`at` integer NOT NULL,
	`template_id` text NOT NULL,
	`version_id` text NOT NULL,
	`version_number` integer,
	`consumer_id` text,
	`channel` text NOT NULL,
	`is_preview` integer DEFAULT false NOT NULL,
	`correlation_id` text NOT NULL,
	`outcome` text NOT NULL,
	`error_code` text,
	`duration_ms` integer
);
--> statement-breakpoint
CREATE INDEX `render_log_template_at` ON `render_log` (`template_id`,`at`);--> statement-breakpoint
CREATE INDEX `render_log_consumer_at` ON `render_log` (`consumer_id`,`at`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `teams` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`icon` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `teams_slug_unique` ON `teams` (`slug`);--> statement-breakpoint
CREATE TABLE `templates` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`content_type_id` text NOT NULL,
	`name` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`starter_key` text,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`content_type_id`) REFERENCES `content_types`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `templates_team` ON `templates` (`team_id`);--> statement-breakpoint
CREATE TABLE `uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`template_id` text,
	`filename` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`path` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`template_id`) REFERENCES `templates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`initials` text NOT NULL,
	`avatar_hue` integer NOT NULL,
	`title` text NOT NULL,
	`is_persona` integer DEFAULT false NOT NULL,
	`platform_role` text,
	`last_active_at` integer
);
--> statement-breakpoint
CREATE TABLE `versions` (
	`id` text PRIMARY KEY NOT NULL,
	`template_id` text NOT NULL,
	`number` integer,
	`state` text NOT NULL,
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
	FOREIGN KEY (`template_id`) REFERENCES `templates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`submitted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sunset_set_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `versions_template` ON `versions` (`template_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `versions_template_number` ON `versions` (`template_id`,`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `versions_one_draft` ON `versions` (`template_id`) WHERE state = 'draft';--> statement-breakpoint
CREATE UNIQUE INDEX `versions_one_active` ON `versions` (`template_id`) WHERE state = 'active';--> statement-breakpoint
CREATE TABLE `sim_customers` (
	`id` text PRIMARY KEY NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`email` text NOT NULL,
	`home_state` text NOT NULL,
	`purchase_apr` text NOT NULL,
	`annual_fee` text
);
--> statement-breakpoint
CREATE TABLE `sim_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`offer_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`channel` text NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`correlation_id` text NOT NULL,
	`output` text,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sim_links` (
	`id` text PRIMARY KEY NOT NULL,
	`offer_id` text NOT NULL,
	`template_id` text NOT NULL,
	`template_name` text NOT NULL,
	`pinned_version` integer NOT NULL,
	`channels` text NOT NULL,
	`mapping` text NOT NULL,
	`linked_at` integer NOT NULL,
	FOREIGN KEY (`offer_id`) REFERENCES `sim_offers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sim_notice_reads` (
	`notice_id` text PRIMARY KEY NOT NULL,
	`read_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sim_offers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`headline` text NOT NULL,
	`terms` text NOT NULL
);
