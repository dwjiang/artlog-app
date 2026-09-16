import { resolveCaptureVisit, setCaptureVisit } from './visit-context';
import { upsertVisit } from '@/db/repos/visits';
import { initializeOwner, switchOwner } from '../account/owner-store';
import { db } from '@/db/client';
import { settings, visits } from '@/db/schema';
jest.mock('@/db/client', () => ({ db: jest.requireActual('@/db/test-db').createTestDatabase() }));
beforeEach(() => { initializeOwner('capture-context'); db.delete(settings).run(); db.delete(visits).run(); });
it('uses current museum context by default and supports a deliberate unlinked capture', async () => {
  const fallback = jest.fn(async () => ({ venueId: 'museum' as never }));
  expect(await resolveCaptureVisit(fallback)).toEqual({ venueId: 'museum' });
  await setCaptureVisit('none');
  expect(await resolveCaptureVisit(fallback)).toEqual({});
  expect(fallback).toHaveBeenCalledTimes(1);
});
it('links a chosen historical visit and never uses another owner’s selection', async () => {
  await upsertVisit({ localId: 'ab7f8f54-0af5-4ac0-8839-bc5fc00e3341', venueId: 'museum' as never, venueName: 'Museum', visitedOn: '2020-01-01', timeZone: 'UTC' });
  await setCaptureVisit('ab7f8f54-0af5-4ac0-8839-bc5fc00e3341');
  expect(await resolveCaptureVisit(async () => ({}))).toMatchObject({ venueId: 'museum', visitLocalId: 'ab7f8f54-0af5-4ac0-8839-bc5fc00e3341' });
  switchOwner('account:other');
  expect(await resolveCaptureVisit(async () => ({}))).toEqual({});
  await setCaptureVisit('ab7f8f54-0af5-4ac0-8839-bc5fc00e3341');
  await expect(resolveCaptureVisit(async () => ({}))).rejects.toThrow('available visit');
});
