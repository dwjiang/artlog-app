import * as repo from './notes';
import { getSavedWork, insertSavedWork, markSynced } from './saved-works';

jest.mock('../client', () => ({ db: jest.requireActual('../test-db').createTestDatabase() }));

it('replaces a note per saved work', async () => {
  for (const localId of ['saved-1', 'saved-2']) {
    await insertSavedWork({ localId, savedAt: 1, title: 'Untitled', artist: 'Unknown', cropPath: `crops/${localId}.jpg` });
  }
  expect(await repo.getNote('saved-1')).toBeUndefined();
  await repo.setNote('saved-1', 'Seen with Sam', 10);
  await repo.setNote('saved-1', 'Seen with Sam and Ana', 20);
  await repo.setNote('saved-2', 'Other', 30);
  expect(await repo.getNote('saved-1')).toMatchObject({ savedLocalId: 'saved-1', text: 'Seen with Sam and Ana', updatedAt: 20 });
  expect(await repo.getNote('saved-2')).toMatchObject({ text: 'Other' });
  await expect(repo.setNote('missing', 'orphan')).rejects.toThrow('FOREIGN KEY');
});

it('rejects oversized notes without changing the saved note or its sync state', async () => {
  await insertSavedWork({ localId: 'limit', savedAt: 1, title: 'Painting', artist: 'Artist' });
  const text = 'a'.repeat(20_000);
  await repo.setNote('limit', text, 10);
  await markSynced([{ localId: 'limit', revision: 1, updatedAt: 20, updatedBy: 'device' as never }]);
  const saved = await getSavedWork('limit');
  await expect(repo.setNote('limit', `${text}a`, 30)).rejects.toThrow('20,000');
  expect(await repo.getNote('limit')).toMatchObject({ text, updatedAt: 10 });
  expect(await getSavedWork('limit')).toEqual(saved);
});
