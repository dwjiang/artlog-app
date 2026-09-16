CREATE TABLE `artworkEncounters` (
	`owner` text NOT NULL,
	`savedLocalId` text NOT NULL,
	`visitLocalId` text NOT NULL,
	`note` text,
	`deletedAt` integer,
	`syncedAt` integer,
	`revision` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner`, `savedLocalId`, `visitLocalId`),
	FOREIGN KEY (`owner`,`savedLocalId`) REFERENCES `savedWorks`(`owner`,`localId`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `artworkEncounters_owner_visit` ON `artworkEncounters` (`owner`,`visitLocalId`);--> statement-breakpoint
CREATE TABLE `artworkPhotos` (
	`owner` text NOT NULL,
	`localId` text NOT NULL,
	`savedLocalId` text NOT NULL,
	`kind` text NOT NULL,
	`capturedAt` integer NOT NULL,
	`visitLocalId` text,
	`caption` text,
	`path` text,
	`storageId` text,
	`deletedAt` integer,
	`syncedAt` integer,
	`revision` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner`, `localId`),
	FOREIGN KEY (`owner`,`savedLocalId`) REFERENCES `savedWorks`(`owner`,`localId`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `artworkPhotos_owner_work` ON `artworkPhotos` (`owner`,`savedLocalId`);