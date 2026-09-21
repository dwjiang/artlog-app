CREATE TABLE `notes` (
	`owner` text NOT NULL,
	`savedLocalId` text NOT NULL,
	`text` text NOT NULL,
	`updatedAt` integer NOT NULL,
	PRIMARY KEY(`owner`, `savedLocalId`),
	FOREIGN KEY (`owner`,`savedLocalId`) REFERENCES `savedWorks`(`owner`,`localId`) ON UPDATE cascade ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `pendingScans` (
	`owner` text NOT NULL,
	`localId` text NOT NULL,
	`photoPath` text NOT NULL,
	`cropPath` text NOT NULL,
	`vector` text NOT NULL,
	`descriptors` blob NOT NULL,
	`keypoints` blob NOT NULL,
	`modelVersion` text NOT NULL,
	`venueId` text,
	`visitId` text,
	`visitLocalId` text,
	`capturedAt` integer NOT NULL,
	`labelPhotoPath` text,
	`qrUrl` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`attemptModelVersion` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`lastError` text,
	`scanId` text,
	`createdAt` integer NOT NULL,
	`reviewedAt` integer,
	PRIMARY KEY(`owner`, `localId`),
	FOREIGN KEY (`owner`,`visitLocalId`) REFERENCES `visits`(`owner`,`localId`) ON UPDATE cascade ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `pendingScans_owner_status_capturedAt` ON `pendingScans` (`owner`,`status`,`capturedAt`);--> statement-breakpoint
CREATE TABLE `savedWorks` (
	`owner` text NOT NULL,
	`localId` text NOT NULL,
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
	`cropPath` text,
	`photoStorageId` text,
	`cropStorageId` text,
	`photoUpdatedAt` integer DEFAULT 0 NOT NULL,
	`syncedAt` integer,
	`revision` integer DEFAULT 0 NOT NULL,
	`syncedBy` text,
	`deletedAt` integer,
	PRIMARY KEY(`owner`, `localId`),
	FOREIGN KEY (`owner`,`visitLocalId`) REFERENCES `visits`(`owner`,`localId`) ON UPDATE cascade ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `savedWorks_owner_savedAt` ON `savedWorks` (`owner`,`savedAt`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `visits` (
	`owner` text NOT NULL,
	`localId` text NOT NULL,
	`venueId` text NOT NULL,
	`venueName` text NOT NULL,
	`visitedOn` text NOT NULL,
	`timeZone` text NOT NULL,
	`reflection` text,
	`startedAt` integer,
	`endedAt` integer,
	`remoteVisitId` text,
	`syncedAt` integer,
	`syncedBy` text,
	`revision` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner`, `localId`)
);
--> statement-breakpoint
CREATE INDEX `visits_owner_history` ON `visits` (`owner`,`visitedOn`,`localId`);