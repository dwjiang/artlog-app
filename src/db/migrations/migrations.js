import journal from './meta/_journal.json';
import m0000 from './0000_create-local-tables.sql';
import m0001 from './0001_artwork-albums.sql';
import m0002 from './0002_drop-photo-storage.sql';

export default { journal, migrations: { m0000, m0001, m0002 } };
