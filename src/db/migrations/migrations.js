// This file is required for Expo/React Native SQLite migrations - https://orm.drizzle.team/quick-sqlite/expo

import journal from './meta/_journal.json';
import m0000 from './0000_create-local-tables.sql';
import m0001 from './0001_artwork-albums.sql';
import m0002 from './0002_drop-photo-storage.sql';
import m0003 from './0003_drop-scan-review.sql';
import m0004 from './0004_visit-visibility.sql';
import m0005 from './0005_offline-scan-results.sql';
import m0006 from './0006_crop-corners.sql';
import m0007 from './0007_crop-source.sql';
import m0008 from './0008_drop-artwork-notes.sql';
import m0009 from './0009_restore-legacy-albums.sql';
import m0010 from './0010_photo-recovery.sql';
import m0011 from './0011_defer-remote-album-recovery.sql';
import m0012 from './0012_visit-discard.sql';

export default { journal, migrations: { m0000, m0001, m0002, m0003, m0004, m0005, m0006, m0007, m0008, m0009, m0010, m0011, m0012 } };
