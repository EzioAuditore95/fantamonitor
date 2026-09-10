CREATE TABLE `lineup_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`league` text NOT NULL,
	`season` text NOT NULL,
	`competition` text NOT NULL,
	`team` text NOT NULL,
	`round` integer NOT NULL,
	`revision` integer NOT NULL,
	`recorded_at` text NOT NULL,
	`recorded_by` text NOT NULL,
	`body` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_scope_revision` ON `lineup_reviews` (`league`,`season`,`competition`,`team`,`round`,`revision`);