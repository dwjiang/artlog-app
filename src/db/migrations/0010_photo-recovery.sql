ALTER TABLE `pendingScans` ADD `savedPhotoLocalId` text;
--> statement-breakpoint
ALTER TABLE `artworkPhotos` ADD `recoveryStorageId` text;
--> statement-breakpoint
UPDATE `pendingScans` AS s
SET `savedPhotoLocalId` = (
  SELECT p.`localId` FROM `artworkPhotos` p
  JOIN `savedWorks` w ON w.`owner` = p.`owner` AND w.`localId` = p.`savedLocalId`
  WHERE p.`owner` = s.`owner`
    AND (p.`localId` = s.`localId` OR p.`path` = s.`photoPath`
      OR (p.`localId` = w.`localId` AND w.`photoPath` = s.`photoPath`))
  ORDER BY (p.`deletedAt` IS NULL AND w.`deletedAt` IS NULL) DESC, w.`savedAt`, p.`localId`
  LIMIT 1
);
