import { renderHook } from '@testing-library/react-native';

import type { PendingScan } from '@/db/schema';

const mockAuth = { isAuthenticated: false };
const mockStart = jest.fn();
const mockStop = jest.fn();
let mockRows: Partial<PendingScan>[] = [];

jest.mock('convex/react', () => ({ useConvexAuth: () => mockAuth }));
jest.mock('drizzle-orm/expo-sqlite', () => ({ useLiveQuery: () => ({ data: mockRows }) }));
jest.mock('@/db/repos/pending-scans', () => ({ pendingScansQuery: () => 'query' }));
jest.mock('./queue', () => ({ startQueueFlusher: () => mockStart() }));

// eslint-disable-next-line import/first
import { useQueue, useQueueFlusher } from './use-queue';

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.isAuthenticated = false;
  mockStart.mockReturnValue(mockStop);
});

it('counts queued and identifying rows as pending while listing failed ones too', async () => {
  mockRows = [{ localId: 'a', status: 'queued' }, { localId: 'b', status: 'identifying' }, { localId: 'c', status: 'failed' }];
  const hook = await renderHook(useQueue);
  expect(hook.result.current.pending).toBe(2);
  expect(hook.result.current.items.map((row) => row.localId)).toEqual(['a', 'b', 'c']);
});

it('starts the flusher only once the session is authenticated and stops it on unmount', async () => {
  const hook = await renderHook(useQueueFlusher);
  expect(mockStart).not.toHaveBeenCalled();
  mockAuth.isAuthenticated = true;
  await hook.rerender(undefined);
  expect(mockStart).toHaveBeenCalledTimes(1);
  await hook.unmount();
  expect(mockStop).toHaveBeenCalledTimes(1);
});
