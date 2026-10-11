INSERT INTO `artworkPhotos` (`owner`, `localId`, `savedLocalId`, `kind`, `capturedAt`, `visitLocalId`, `path`, `storageId`, `deletedAt`)
SELECT w.`owner`, w.`localId`, w.`localId`, 'full', w.`savedAt`, w.`visitLocalId`,
  CASE WHEN w.`photoPath` IS NOT NULL OR w.`photoStorageId` IS NOT NULL THEN w.`photoPath` ELSE w.`cropPath` END,
  CASE WHEN w.`photoPath` IS NOT NULL OR w.`photoStorageId` IS NOT NULL THEN w.`photoStorageId` ELSE w.`cropStorageId` END,
  w.`deletedAt`
FROM `savedWorks` w
WHERE (w.`photoPath` IS NOT NULL OR w.`photoStorageId` IS NOT NULL OR w.`cropPath` IS NOT NULL OR w.`cropStorageId` IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM `artworkPhotos` p WHERE p.`owner` = w.`owner`
    AND (p.`localId` = w.`localId`
      OR (p.`savedLocalId` = w.`localId` AND p.`capturedAt` = w.`savedAt`)
      OR p.`localId` IN (
      SELECT s.`localId` FROM `pendingScans` s
      WHERE s.`owner` = w.`owner` AND s.`photoPath` = w.`photoPath`)
      OR p.`path` = w.`photoPath` OR p.`path` = w.`cropPath` OR p.`storageId` = w.`photoStorageId`));
--> statement-breakpoint
ALTER TABLE `savedWorks` DROP COLUMN `photoStorageId`;
