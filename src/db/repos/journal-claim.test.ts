import { db } from '../client';
import { notes, pendingScans, savedWorks, settings, visits } from '../schema';
import { claimLocalJournal } from './journal-claim';
import * as saves from './saved-works';
import * as visitRepo from './visits';
import { getNote, setNote } from './notes';
import { getSetting, setSetting } from './settings';
import { anonymousOwner, initializeOwner, switchOwner } from '../../lib/account/owner-store';

jest.mock('../client', () => ({ db: jest.requireActual('../test-db').createTestDatabase() }));
beforeEach(async () => {
  await db.delete(notes); await db.delete(savedWorks); await db.delete(pendingScans); await db.delete(visits); await db.delete(settings);
  initializeOwner('test-installation');
});
it('claims associations, notes, photos and tombstones atomically and safely repeats', async () => {
  const source = anonymousOwner();
  await visitRepo.upsertVisit({ localId: 'e7257140-7164-58eb-88ac-f010276ded02', venueId: 'museum' as never, venueName: 'Museum', visitedOn: '2026-09-01', timeZone: 'UTC' });
  await saves.insertSavedWork({ localId: 'save', visitLocalId: 'e7257140-7164-58eb-88ac-f010276ded02', venueId: 'museum' as never, title: 'Work', artist: '', savedAt: 1, photoPath: 'photo.jpg', deletedAt: 2 });
  await setNote('save', 'My note');
  await claimLocalJournal(source, 'account:a', 'claim'); await claimLocalJournal(source, 'account:a', 'claim');
  expect(await saves.getSavedWork('save')).toBeUndefined();
  switchOwner('account:a');
  expect(await saves.getSavedWork('save')).toMatchObject({ owner: 'account:a', visitLocalId: 'e7257140-7164-58eb-88ac-f010276ded02', venueId: 'museum' as never, photoPath: 'photo.jpg', deletedAt: 2 });
  expect(await getNote('save')).toMatchObject({ text: 'My note', owner: 'account:a' });
  expect(await visitRepo.getVisit('e7257140-7164-58eb-88ac-f010276ded02')).toMatchObject({ owner: 'account:a' });
});
it('carries the open and hand-ended visits to the account unless the account already has them, and drops dangling ones', async () => {
  const source = anonymousOwner();
  await visitRepo.upsertVisit({ localId: 'e7257140-7164-58eb-88ac-f010276ded02', venueId: 'museum' as never, venueName: 'Museum', visitedOn: '2026-09-01', timeZone: 'UTC' });
  await visitRepo.upsertVisit({ localId: '0b1e4c8a-2d3f-4e5a-9b6c-7d8e9f0a1b2c', venueId: 'other' as never, venueName: 'Other', visitedOn: '2026-09-01', timeZone: 'UTC', startedAt: Date.UTC(2026, 8, 1, 10), endedAt: Date.UTC(2026, 8, 1, 12) });
  await setSetting(`currentVisit:${source}`, 'e7257140-7164-58eb-88ac-f010276ded02');
  await setSetting(`endedVisit:${source}`, '0b1e4c8a-2d3f-4e5a-9b6c-7d8e9f0a1b2c');
  await claimLocalJournal(source, 'account:a', 'claim');
  expect(await getSetting('currentVisit:account:a')).toBe('e7257140-7164-58eb-88ac-f010276ded02');
  expect(await getSetting('endedVisit:account:a')).toBe('0b1e4c8a-2d3f-4e5a-9b6c-7d8e9f0a1b2c');
  expect(await getSetting(`currentVisit:${source}`)).toBeUndefined();
  expect(await getSetting(`endedVisit:${source}`)).toBeUndefined();
  await setSetting(`currentVisit:${source}`, 'missing-visit');
  await setSetting(`endedVisit:${source}`, 'missing-visit');
  await claimLocalJournal(source, 'account:a', 'again');
  expect(await getSetting('currentVisit:account:a')).toBe('e7257140-7164-58eb-88ac-f010276ded02');
  expect(await getSetting('endedVisit:account:a')).toBe('0b1e4c8a-2d3f-4e5a-9b6c-7d8e9f0a1b2c');
  expect(await getSetting(`currentVisit:${source}`)).toBeUndefined();
  expect(await getSetting(`endedVisit:${source}`)).toBeUndefined();
});
it('carries the seen visits to the account, merged with the ones the account already opened', async () => {
  const source = anonymousOwner();
  await setSetting(`seenVisits:${source}`, '["opened-anonymously","opened-twice"]');
  await setSetting('seenVisits:account:a', '["opened-twice","opened-signed-in"]');
  await claimLocalJournal(source, 'account:a', 'claim');
  expect(JSON.parse((await getSetting('seenVisits:account:a'))!)).toEqual(['opened-twice', 'opened-signed-in', 'opened-anonymously']);
  expect(await getSetting(`seenVisits:${source}`)).toBeUndefined();
  await setSetting(`seenVisits:${source}`, 'not json');
  await claimLocalJournal(source, 'account:b', 'again');
  expect(JSON.parse((await getSetting('seenVisits:account:b'))!)).toEqual([]);
  expect(await getSetting(`seenVisits:${source}`)).toBeUndefined();
});
it('carries queued index shares to the account with their captures', async () => {
  const source = anonymousOwner();
  await setSetting(`pendingShare:${source}:scan-1`, '{"scanId":"scan-1","captureLocalId":"capture"}');
  await claimLocalJournal(source, 'account:a', 'claim');
  expect(await getSetting('pendingShare:account:a:scan-1')).toBe('{"scanId":"scan-1","captureLocalId":"capture"}');
  expect(await getSetting(`pendingShare:${source}:scan-1`)).toBeUndefined();
});
it('hides account rows and suspends edits on sign-out, restores them on sign-in, and never reassigns them', async () => {
  await saves.insertSavedWork({ localId: 'save', title: 'A', artist: '', savedAt: 1 }, 'account:a');
  switchOwner('account:a'); await setNote('save', 'A note');
  switchOwner(anonymousOwner()); expect(await saves.listUnsynced()).toEqual([]); expect(await getNote('save')).toBeUndefined();
  await saves.insertSavedWork({ localId: 'save', title: 'Anonymous', artist: '', savedAt: 1 });
  await claimLocalJournal(anonymousOwner(), 'account:b', 'b');
  switchOwner('account:b'); expect((await saves.getSavedWork('save'))?.title).toBe('Anonymous');
  switchOwner('account:a'); expect((await getNote('save'))?.text).toBe('A note'); expect(await saves.listUnsynced()).toHaveLength(1);
});
it('rejects collisions before moving any rows and enforces owner foreign keys', async () => {
  await saves.insertSavedWork({ localId: 'same', title: 'A', artist: '', savedAt: 1 }, 'account:a');
  await saves.insertSavedWork({ localId: 'same', title: 'Anonymous', artist: '', savedAt: 1 });
  await expect(claimLocalJournal(anonymousOwner(), 'account:a', 'a')).rejects.toThrow('collision');
  expect((await saves.getSavedWork('same'))?.title).toBe('Anonymous');
  await visitRepo.upsertVisit({ localId: '41ab4ed1-5dcf-560c-bf4c-741d73a7f9d5', venueId: 'museum' as never, venueName: 'Museum', visitedOn: '2026-09-01', timeZone: 'UTC' }, 'account:a');
  await expect(saves.insertSavedWork({ localId: 'wrong', visitLocalId: '41ab4ed1-5dcf-560c-bf4c-741d73a7f9d5', title: 'Wrong', artist: '', savedAt: 1 })).rejects.toThrow();
});
