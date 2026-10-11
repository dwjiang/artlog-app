CREATE TABLE `notes` (
	`savedLocalId` text PRIMARY KEY NOT NULL,
	`text` text NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`savedLocalId`) REFERENCES `savedWorks`(`localId`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `pendingScans` (
	`localId` text PRIMARY KEY NOT NULL,
	`photoPath` text NOT NULL,
	`cropPath` text NOT NULL,
	`vector` text NOT NULL,
	`descriptors` blob NOT NULL,
	`keypoints` blob NOT NULL,
	`modelVersion` text NOT NULL,
	`venueId` text,
	`visitId` text,
	`capturedAt` integer NOT NULL,
	`labelPhotoPath` text,
	`qrUrl` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`attemptModelVersion` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`lastError` text,
	`scanId` text,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `pendingScans_status_capturedAt` ON `pendingScans` (`status`,`capturedAt`);--> statement-breakpoint
CREATE TABLE `savedWorks` (
	`localId` text PRIMARY KEY NOT NULL,
	`visitLocalId` text,
	`venueId` text,
	`venueName` text,
	`gallery` text,
	`savedAt` integer NOT NULL,
	`title` text NOT NULL,
	`artist` text NOT NULL,
	`date` text,
	`medium` text,
	`institution` text,
	`objectId` text,
	`artworkId` text,
	`scanId` text,
	`photoPath` text,
	`cropPath` text NOT NULL,
	`syncedAt` integer,
	`deletedAt` integer,
	FOREIGN KEY (`visitLocalId`) REFERENCES `visits`(`localId`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `savedWorks_savedAt` ON `savedWorks` (`savedAt`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `visits` (
	`localId` text PRIMARY KEY NOT NULL,
	`venueId` text NOT NULL,
	`venueName` text NOT NULL,
	`startedAt` integer NOT NULL,
	`endedAt` integer,
	`remoteVisitId` text
);
