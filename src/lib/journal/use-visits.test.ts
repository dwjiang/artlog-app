import { renderHook } from '@testing-library/react-native';
import { useVisits } from './use-visits';
import { useVisitWorks } from './use-visit-works';

const mockReads: Record<string, { data: never[]; updatedAt?: Date; error?: Error }> = {};
jest.mock('drizzle-orm/expo-sqlite', () => ({ useLiveQuery: (query: string) => mockReads[query] }));
jest.mock('@/db/repos/artwork-album', () => ({ selectArtworkEncounters: () => 'encounters' }));
jest.mock('@/db/repos/saved-works', () => ({ listSavedWorks: () => 'works' }));
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
