CREATE TABLE `offlineScanResults` (
  `owner` text NOT NULL,
  `localId` text NOT NULL,
  `result` text NOT NULL,
  PRIMARY KEY (`owner`, `localId`),
  FOREIGN KEY (`owner`, `localId`) REFERENCES `pendingScans` (`owner`, `localId`) ON UPDATE CASCADE ON DELETE CASCADE
);
