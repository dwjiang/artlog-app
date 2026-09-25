// This file is required for Expo/React Native SQLite migrations - https://orm.drizzle.team/quick-sqlite/expo

import journal from './meta/_journal.json';
import m0000 from './0000_create-local-tables.sql';
import m0001 from './0001_artwork-albums.sql';
import m0002 from './0002_drop-photo-storage.sql';
import m0003 from './0003_drop-scan-review.sql';
import m0004 from './0004_visit-visibility.sql';
import m0005 from './0005_offline-scan-results.sql';
import m0006 from './0006_crop-corners.sql';

export default { journal, migrations: { m0000, m0001, m0002, m0003, m0004, m0005, m0006 } };
