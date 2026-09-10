import { afterEach, expect, it, vi } from 'vitest';

import { api } from './_generated/api';
import { seedDevice, seedMuseum } from './lib/testFactories';
import { harness } from './test.helpers';

afterEach(() => vi.useRealTimers());

async function fixture() {
  vi.useFakeTimers();
  const t = harness();
  const user = await seedDevice(t);
  const venueId = await t.run((ctx) => seedMuseum(ctx));
  return { t, user, venueId };
}

it('starts a visit and makes it the current one', async () => {
  const { user, venueId } = await fixture();
  expect(await user.as.query(api.visits.current, {})).toBeNull();
  const result = await user.as.mutation(api.visits.startVisit, { venueId, localVisitId: 'one' });
  expect(await user.as.query(api.visits.current, {})).toMatchObject({ _id: result.visitId, venueId });
});

it('resumes the most recent open visit at the same venue within four hours', async () => {
  const { user, venueId } = await fixture();
  const first = await user.as.mutation(api.visits.startVisit, { venueId, localVisitId: 'one' });
  vi.advanceTimersByTime(4 * 60 * 60 * 1000 - 1);
  expect(await user.as.mutation(api.visits.startVisit, { venueId, localVisitId: 'two' })).toEqual(first);
});

it('starts a new visit after four hours and closes the previous visit', async () => {
  const { t, user, venueId } = await fixture();
  const first = await user.as.mutation(api.visits.startVisit, { venueId, localVisitId: 'one' });
  vi.advanceTimersByTime(4 * 60 * 60 * 1000);
  const second = await user.as.mutation(api.visits.startVisit, { venueId, localVisitId: 'two' });
  expect(second.visitId).not.toBe(first.visitId);
  expect((await t.run((ctx) => ctx.db.get(first.visitId)))?.endedAt).toBe(Date.now());
});

it('switching venues starts a new visit, and ending it leaves no current visit', async () => {
  const { t, user, venueId } = await fixture();
  const first = await user.as.mutation(api.visits.startVisit, { venueId, localVisitId: 'one' });
  const otherVenue = await t.run((ctx) => seedMuseum(ctx));
  const second = await user.as.mutation(api.visits.startVisit, { venueId: otherVenue, localVisitId: 'two' });
  expect(second.visitId).not.toBe(first.visitId);
  await user.as.mutation(api.visits.endVisit, { visitId: second.visitId });
  expect(await user.as.query(api.visits.current, {})).toBeNull();
});

it('retries of a local visit id are idempotent even after the visit ended', async () => {
  const { user, venueId } = await fixture();
  const args = { venueId, localVisitId: 'one' };
  const first = await user.as.mutation(api.visits.startVisit, args);
  await user.as.mutation(api.visits.endVisit, { visitId: first.visitId });
  expect(await user.as.mutation(api.visits.startVisit, args)).toEqual(first);
  expect(await user.as.query(api.visits.current, {})).toBeNull();
  expect((await user.as.mutation(api.visits.startVisit, { ...args, localVisitId: 'two' })).visitId).not.toBe(first.visitId);
});

it.each(['ended', 'expired', 'switched'] as const)('keeps every resumed local id idempotent after the visit is %s', async (transition) => {
  const { t, user, venueId } = await fixture();
  const first = await user.as.mutation(api.visits.startVisit, { venueId, localVisitId: 'one' });
  for (const localVisitId of ['two', 'three']) {
    expect(await user.as.mutation(api.visits.startVisit, { venueId, localVisitId })).toEqual(first);
  }
  if (transition === 'ended') await user.as.mutation(api.visits.endVisit, { visitId: first.visitId });
  if (transition === 'expired') vi.advanceTimersByTime(4 * 60 * 60 * 1000);
  if (transition === 'switched') {
    const otherVenueId = await t.run((ctx) => seedMuseum(ctx));
    vi.advanceTimersByTime(1);
    await user.as.mutation(api.visits.startVisit, { venueId: otherVenueId, localVisitId: 'other' });
  }
  const current = await user.as.query(api.visits.current, {});
  for (const localVisitId of ['one', 'two', 'three']) {
    expect(await user.as.mutation(api.visits.startVisit, { venueId, localVisitId })).toEqual(first);
  }
  expect(await user.as.query(api.visits.current, {})).toEqual(current);
});

it('scopes resumed local ids to their device and original venue', async () => {
  const { t, user, venueId } = await fixture();
  const first = await user.as.mutation(api.visits.startVisit, { venueId, localVisitId: 'one' });
  await user.as.mutation(api.visits.startVisit, { venueId, localVisitId: 'two' });
  const otherVenueId = await t.run((ctx) => seedMuseum(ctx));
  await expect(user.as.mutation(api.visits.startVisit, { venueId: otherVenueId, localVisitId: 'two' }))
    .rejects.toMatchObject({ data: { code: 'invalid_visit' } });
  const other = await seedDevice(t);
  const separate = await other.as.mutation(api.visits.startVisit, { venueId: otherVenueId, localVisitId: 'two' });
  expect(separate.visitId).not.toBe(first.visitId);
});

it('scopes visits to the authenticated device and refuses another device ending them', async () => {
  const { t, user, venueId } = await fixture();
  const { visitId } = await user.as.mutation(api.visits.startVisit, { venueId, localVisitId: 'one' });
  const other = await seedDevice(t);
  expect(await other.as.query(api.visits.current, {})).toBeNull();
  await expect(other.as.mutation(api.visits.endVisit, { visitId })).rejects.toMatchObject({ data: { code: 'invalid_visit' } });
  await expect(t.query(api.visits.current, {})).rejects.toMatchObject({ data: { code: 'unauthenticated' } });
  await expect(t.mutation(api.visits.startVisit, { venueId, localVisitId: 'one' })).rejects.toMatchObject({ data: { code: 'unauthenticated' } });
});

it('rejects missing venues, empty local ids, and reusing an id for a different venue', async () => {
  const { t, user, venueId } = await fixture();
  await expect(user.as.mutation(api.visits.startVisit, { venueId, localVisitId: '' })).rejects.toThrow();
  await user.as.mutation(api.visits.startVisit, { venueId, localVisitId: 'one' });
  const otherVenue = await t.run((ctx) => seedMuseum(ctx));
  await expect(user.as.mutation(api.visits.startVisit, { venueId: otherVenue, localVisitId: 'one' })).rejects.toMatchObject({ data: { code: 'invalid_visit' } });
  await t.run((ctx) => ctx.db.delete(otherVenue));
  await expect(user.as.mutation(api.visits.startVisit, { venueId: otherVenue, localVisitId: 'two' })).rejects.toMatchObject({ data: { code: 'invalid_venue' } });
});
