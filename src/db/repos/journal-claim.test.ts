import { db } from '../client';
import { notes, pendingScans, savedWorks, settings, visits } from '../schema';
import { claimLocalJournal } from './journal-claim';
import * as saves from './saved-works';
import * as visitRepo from './visits';
import { getNote, setNote } from './notes';
import { anonymousOwner, initializeOwner, switchOwner } from '../../lib/account/owner-store';

jest.mock('../client', () => ({ db: jest.requireActual('../test-db').createTestDatabase() }));
beforeEach(async () => {
  await db.delete(notes); await db.delete(savedWorks); await db.delete(pendingScans); await db.delete(visits); await db.delete(settings);
  initializeOwner('test-installation');
});
it('claims associations, notes, photos and tombstones atomically and safely repeats', async () => {
  const source = anonymousOwner();
  await visitRepo.upsertVisit({ localId: 'visit', venueId: 'museum' as never, venueName: 'Museum', visitedOn: '2026-09-01', timeZone: 'UTC' });
  await saves.insertSavedWork({ localId: 'save', visitLocalId: 'visit', venueId: 'museum' as never, title: 'Work', artist: '', savedAt: 1, photoPath: 'photo.jpg', deletedAt: 2 });
  await setNote('save', 'My note');
  await claimLocalJournal(source, 'account:a', 'claim'); await claimLocalJournal(source, 'account:a', 'claim');
  expect(await saves.getSavedWork('save')).toBeUndefined();
  switchOwner('account:a');
  expect(await saves.getSavedWork('save')).toMatchObject({ owner: 'account:a', visitLocalId: 'visit', photoPath: 'photo.jpg', deletedAt: 2 });
  expect(await getNote('save')).toMatchObject({ text: 'My note', owner: 'account:a' });
  expect(await visitRepo.getVisit('visit')).toMatchObject({ owner: 'account:a' });
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
  await visitRepo.upsertVisit({ localId: 'private', venueId: 'museum' as never, venueName: 'Museum', visitedOn: '2026-09-01', timeZone: 'UTC' }, 'account:a');
  await expect(saves.insertSavedWork({ localId: 'wrong', visitLocalId: 'private', title: 'Wrong', artist: '', savedAt: 1 })).rejects.toThrow();
});
