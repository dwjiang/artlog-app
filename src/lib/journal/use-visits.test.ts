import { act, renderHook } from '@testing-library/react-native';
import { scheduleRemoval, undoRemoval, usePendingRemovals } from '../collection/pending-removals';
import { useVisits } from './use-visits';
import { useVisitWorks } from './use-visit-works';

const mockReads: Record<string, { data: unknown[]; updatedAt?: Date; error?: Error }> = {};
jest.mock('drizzle-orm/expo-sqlite', () => ({ useLiveQuery: (query: string) => mockReads[query] }));
jest.mock('@/db/repos/artwork-album', () => ({ selectArtworkEncounters: () => 'encounters' }));
jest.mock('@/db/repos/saved-works', () => ({ listSavedWorks: () => 'works', softDeleteSavedWork: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/db/repos/visits', () => ({ listVisits: () => 'visits' }));
jest.mock('../account/owner-store', () => ({ useLocalOwner: () => 'account:a' }));
jest.mock('./use-venue-metadata', () => ({ useVenueMetadata: () => ({ metadata: new Map(), ready: true }) }));

beforeEach(() => {
  for (const key of ['encounters', 'works', 'visits']) mockReads[key] = { data: [], updatedAt: new Date() };
});

it.each(['visit summaries', 'visit artworks'])('keeps %s loading until artwork links finish, even when other reads are empty', async (kind) => {
  mockReads.encounters.updatedAt = undefined;
  const hook = kind === 'visit summaries' ? useVisits : () => useVisitWorks('visit', 'account:a');
  const view = await renderHook<{ loading: boolean; error?: Error }, unknown>(hook);
  expect(view.result.current.loading).toBe(true);
  mockReads.encounters.updatedAt = new Date();
  await view.rerender({});
  expect(view.result.current.loading).toBe(false);
  expect(view.result.current.error).toBeUndefined();
});

it.each(['visit summaries', 'visit artworks'])('stops the %s indicator and reports a failed artwork-link read', async (kind) => {
  const error = new Error('Local read failed');
  mockReads.encounters = { data: [], error };
  const hook = kind === 'visit summaries' ? useVisits : () => useVisitWorks('visit', 'account:a');
  const view = await renderHook<{ loading: boolean; error?: Error }, unknown>(hook);
  expect(view.result.current.loading).toBe(false);
  expect(view.result.current.error).toBe(error);
});

it.each(['expires', 'is undone'])('keeps visit previews and active-visit counts consistent when a removal %s', async (outcome) => {
  jest.useFakeTimers();
  const work = { owner: 'account:a', localId: `removal-${outcome}`, title: 'Water Lilies', deletedAt: null };
  try {
    mockReads.works.data = [work];
    mockReads.visits.data = [{ owner: work.owner, localId: 'visit', venueId: 'museum', venueName: 'Museum', visitedOn: '2026-09-22', timeZone: 'UTC' }];
    mockReads.encounters.data = [{ owner: work.owner, visitLocalId: 'visit', savedLocalId: work.localId, deletedAt: null }];
    const summaries = await renderHook(useVisits);
    const active = await renderHook(() => useVisitWorks('visit', work.owner));
    const toast = await renderHook(usePendingRemovals);
    expect(summaries.result.current.visits[0].works).toHaveLength(1);
    expect(active.result.current.works).toHaveLength(1);

    await act(() => scheduleRemoval(work));
    expect(summaries.result.current.visits).toHaveLength(1);
    expect(summaries.result.current.visits[0].works).toEqual([]);
    expect(active.result.current.works).toEqual([]);
    expect(summaries.result.current.loading).toBe(false);
    expect(active.result.current.loading).toBe(false);

    if (outcome === 'is undone') await act(() => undoRemoval(work));
    await act(() => jest.advanceTimersByTime(6000));
    expect(toast.result.current).toEqual([]);
    const expected = outcome === 'is undone' ? [work] : [];
    expect(summaries.result.current.visits[0].works).toEqual(expected);
    expect(active.result.current.works).toEqual(expected);

    if (outcome === 'expires') {
      mockReads.works.data = [];
      mockReads.encounters.data = [];
      await summaries.rerender({});
      await active.rerender({});
      expect(summaries.result.current.visits).toHaveLength(1);
      expect(summaries.result.current.visits[0].works).toEqual([]);
      expect(active.result.current.works).toEqual([]);
    }
  } finally {
    await act(() => undoRemoval(work));
    jest.useRealTimers();
  }
});
