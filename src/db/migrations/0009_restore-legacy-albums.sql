INSERT INTO `artworkPhotos` (`owner`, `localId`, `savedLocalId`, `kind`, `capturedAt`, `visitLocalId`, `path`, `storageId`, `deletedAt`)
SELECT w.`owner`, w.`localId`, w.`localId`, 'full', w.`savedAt`, w.`visitLocalId`,
  coalesce(w.`photoPath`, w.`cropPath`),
  CASE WHEN w.`photoPath` IS NULL THEN w.`cropStorageId` ELSE NULL END,
  w.`deletedAt`
FROM `savedWorks` w
WHERE (w.`photoPath` IS NOT NULL OR w.`cropPath` IS NOT NULL OR w.`cropStorageId` IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM `artworkPhotos` p WHERE p.`owner` = w.`owner`
    AND (p.`localId` = w.`localId` OR p.`localId` = w.`cropPhotoLocalId`
      OR (p.`savedLocalId` = w.`localId` AND p.`capturedAt` = w.`savedAt`)
      OR p.`localId` IN (
      SELECT s.`localId` FROM `pendingScans` s
      WHERE s.`owner` = w.`owner` AND s.`photoPath` = w.`photoPath`)
      OR p.`path` = w.`photoPath` OR p.`path` = w.`cropPath`));
--> statement-breakpoint
INSERT INTO `artworkEncounters` (`owner`, `savedLocalId`, `visitLocalId`)
SELECT w.`owner`, w.`localId`, w.`visitLocalId`
FROM `savedWorks` w
WHERE w.`deletedAt` IS NULL AND w.`visitLocalId` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `artworkEncounters` e WHERE e.`owner` = w.`owner`
    AND e.`savedLocalId` = w.`localId` AND e.`visitLocalId` = w.`visitLocalId`);
