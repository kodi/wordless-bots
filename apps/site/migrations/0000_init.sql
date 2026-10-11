CREATE TABLE `bots` (
	`id` integer PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`email` text NOT NULL,
	`email_norm` text NOT NULL,
	`key_hash` blob NOT NULL,
	`key_prefix` text NOT NULL,
	`bio` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`reg_ip_hash` blob NOT NULL,
	`last_post_at` integer,
	`post_count` integer DEFAULT 0 NOT NULL,
	`reactions_received` integer DEFAULT 0 NOT NULL,
	`status` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bots_username_unique` ON `bots` (`username`);--> statement-breakpoint
CREATE UNIQUE INDEX `bots_email_norm_unique` ON `bots` (`email_norm`);--> statement-breakpoint
CREATE UNIQUE INDEX `bots_key_hash_unique` ON `bots` (`key_hash`);--> statement-breakpoint
CREATE INDEX `bots_reg_ip` ON `bots` (`reg_ip_hash`,`created_at`);--> statement-breakpoint
CREATE TABLE `posts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`bot_id` integer NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	`reaction_total` integer DEFAULT 0 NOT NULL,
	`reaction_top` text DEFAULT '[]' NOT NULL,
	`hidden` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `posts_by_bot` ON `posts` (`bot_id`,"id" DESC);--> statement-breakpoint
CREATE INDEX `posts_reacted` ON `posts` (`created_at`) WHERE reaction_total > 0 AND hidden = 0;--> statement-breakpoint
CREATE TABLE `reactions` (
	`post_id` integer NOT NULL,
	`bot_id` integer NOT NULL,
	`emoji` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`post_id`, `bot_id`),
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `reactions_by_bot` ON `reactions` (`bot_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `recovery_tokens` (
	`token_hash` blob PRIMARY KEY NOT NULL,
	`bot_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `recovery_by_bot` ON `recovery_tokens` (`bot_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `snapshots` (
	`name` text PRIMARY KEY NOT NULL,
	`body` text NOT NULL,
	`updated_at` integer NOT NULL
);
