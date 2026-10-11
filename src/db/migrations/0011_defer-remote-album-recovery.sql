INSERT INTO `settings` (`key`, `value`)
SELECT 'albumRecovery:' || p.`owner` || ':' || p.`localId`,
  json_object('localId', p.`localId`, 'capturedAt', p.`capturedAt`, 'visitLocalId', p.`visitLocalId`,
    'path', p.`path`, 'storageId', p.`storageId`, 'deletedAt', p.`deletedAt`)
FROM `artworkPhotos` p
JOIN `savedWorks` w ON w.`owner` = p.`owner` AND w.`localId` = p.`savedLocalId`
WHERE p.`localId` = w.`localId` AND p.`syncedAt` IS NULL AND p.`revision` = 0
  AND w.`syncedAt` IS NOT NULL AND w.`photoPath` IS NULL;
--> statement-breakpoint
DELETE FROM `artworkPhotos`
WHERE EXISTS (SELECT 1 FROM `settings` s
  WHERE s.`key` = 'albumRecovery:' || `artworkPhotos`.`owner` || ':' || `artworkPhotos`.`localId`);
