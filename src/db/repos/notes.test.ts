import * as repo from './notes';
import { insertSavedWork } from './saved-works';

jest.mock('../client', () => ({ db: jest.requireActual('../test-db').createTestDatabase() }));

it('replaces a note per saved work', async () => {
  for (const localId of ['saved-1', 'saved-2']) {
    await insertSavedWork({ localId, savedAt: 1, title: 'Untitled', artist: 'Unknown', cropPath: `crops/${localId}.jpg` });
  }
  expect(await repo.getNote('saved-1')).toBeUndefined();
  await repo.setNote('saved-1', 'Seen with Sam', 10);
  await repo.setNote('saved-1', 'Seen with Sam and Ana', 20);
  await repo.setNote('saved-2', 'Other', 30);
  expect(await repo.getNote('saved-1')).toEqual({ savedLocalId: 'saved-1', text: 'Seen with Sam and Ana', updatedAt: 20 });
  expect(await repo.getNote('saved-2')).toMatchObject({ text: 'Other' });
  await expect(repo.setNote('missing', 'orphan')).rejects.toThrow('FOREIGN KEY');
});
