// expo-sqlite needs the native runtime. Jest gets a stub so modules that open the database can load;
// tests that query mock `@/db/client` with `createTestDatabase()` from src/db/test-db.ts instead.
function unavailable(): never {
  throw new Error('expo-sqlite is unavailable under Jest; mock @/db/client with createTestDatabase()');
}

export function openDatabaseSync(databaseName: string) {
  return { databasePath: databaseName, prepareSync: unavailable, getFirstSync: unavailable, execSync() {}, runSync: unavailable };
}

export function addDatabaseChangeListener() {
  return { remove() {} };
}
