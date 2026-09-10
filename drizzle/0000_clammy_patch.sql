CREATE TABLE `observations` (
	`id` text PRIMARY KEY NOT NULL,
	`league` text NOT NULL,
	`season` text NOT NULL,
	`competition` text NOT NULL,
	`round` integer NOT NULL,
	`observed_at` text NOT NULL,
	`imported_at` text NOT NULL,
	`imported_by` text NOT NULL,
	`body` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `observation_scope_time` ON `observations` (`league`,`season`,`competition`,`round`,`observed_at`);--> statement-breakpoint
CREATE INDEX `observation_league_time` ON `observations` (`league`,`observed_at`);