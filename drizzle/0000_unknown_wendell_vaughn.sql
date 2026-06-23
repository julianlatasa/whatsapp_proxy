CREATE TABLE `blocked_contacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`jid` text,
	`lid` text,
	`blocked_at` integer DEFAULT (unixepoch('now','subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_blocked_contacts_jid` ON `blocked_contacts` (`jid`);--> statement-breakpoint
CREATE INDEX `idx_blocked_contacts_lid` ON `blocked_contacts` (`lid`);--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`jid` text,
	`lid` text,
	`push_name` text,
	`first_seen_at` integer DEFAULT (unixepoch('now','subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_contacts_jid` ON `contacts` (`jid`);--> statement-breakpoint
CREATE INDEX `idx_contacts_lid` ON `contacts` (`lid`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`remote_jid` text NOT NULL,
	`from_me` integer DEFAULT false NOT NULL,
	`participant` text,
	`push_name` text,
	`message_timestamp` integer NOT NULL,
	`message_type` text NOT NULL,
	`text_content` text,
	`media_mimetype` text,
	`media_url` text,
	`quoted_message_id` text,
	`raw_payload` text,
	`is_deleted` integer DEFAULT false NOT NULL,
	`is_edited` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'received' NOT NULL,
	`status_timestamp` integer DEFAULT (unixepoch('now','subsec') * 1000) NOT NULL,
	`created_at` integer DEFAULT (unixepoch('now','subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_messages_remote_jid` ON `messages` (`remote_jid`);--> statement-breakpoint
CREATE INDEX `idx_messages_from_me` ON `messages` (`from_me`);