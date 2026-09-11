import * as repo from './settings';

jest.mock('../client', () => ({ db: jest.requireActual('../test-db').createTestDatabase() }));

it('stores, overwrites and removes settings by key', async () => {
  expect(await repo.getSetting('currentVisit')).toBeUndefined();
  await repo.setSetting('currentVisit', 'v1');
  await repo.setSetting('currentVisit', 'v2');
  await repo.setSetting('sharing', 'granted');
  expect(await repo.getSetting('currentVisit')).toBe('v2');
  await repo.removeSetting('currentVisit');
  expect(await repo.getSetting('currentVisit')).toBeUndefined();
  expect(await repo.getSetting('sharing')).toBe('granted');
});
