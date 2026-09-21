import { renderHook } from '@testing-library/react-native';
import { useCollectionData } from './use-collection-data';

const mockReads: Record<string, { data: never[]; updatedAt?: Date; error?: Error }> = {};
jest.mock('drizzle-orm/expo-sqlite', () => ({ useLiveQuery: (query: string) => mockReads[query] }));
jest.mock('@/db/repos/artwork-album', () => ({ selectArtworkEncounters: () => 'encounters', selectAllArtworkPhotos: () => 'photos' }));
jest.mock('@/db/repos/saved-works', () => ({ listSavedWorks: () => 'works' }));
jest.mock('@/db/repos/visits', () => ({ listVisits: () => 'visits' }));
jest.mock('../account/owner-store', () => ({ useLocalOwner: () => 'account:a' }));
jest.mock('../journal/use-venue-metadata', () => ({ useVenueMetadata: () => ({ metadata: new Map(), ready: true }) }));
jest.mock('./pending-removals', () => ({ usePendingRemovals: () => [] }));

beforeEach(() => {
  for (const key of ['encounters', 'photos', 'works', 'visits']) mockReads[key] = { data: [], updatedAt: new Date() };
});

it.each(['encounters', 'photos'])('keeps collection counts pending until %s finish loading', async (key) => {
  mockReads[key].updatedAt = undefined;
  const view = await renderHook(useCollectionData);
  expect(view.result.current.loading).toBe(true);
  mockReads[key].updatedAt = new Date();
  await view.rerender({});
  expect(view.result.current.loading).toBe(false);
});

it.each(['encounters', 'photos'])('ends loading and surfaces a failed %s read', async (key) => {
  const error = new Error('Local read failed');
  mockReads[key] = { data: [], error };
  const view = await renderHook(useCollectionData);
  expect(view.result.current.loading).toBe(false);
  expect(view.result.current.error).toBe(error);
});
