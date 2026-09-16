import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { softDeleteSavedWork } from '@/db/repos/saved-works';
import { commitRemoval, scheduleRemoval, undoRemoval, usePendingRemovals } from './pending-removals';
jest.mock('@/db/repos/saved-works', () => ({ softDeleteSavedWork: jest.fn().mockResolvedValue(undefined) }));
let appStateListener: ((state: AppStateStatus) => void) | undefined;
beforeEach(() => {
  jest.useFakeTimers(); jest.clearAllMocks();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => { appStateListener = listener; return { remove: jest.fn() }; });
});
afterEach(() => { jest.useRealTimers(); });
it('undo cancels deletion even after the detail screen has closed', async () => {
  const item = { owner: 'account:a', localId: 'undo', title: 'Water Lilies' };
  const view = await renderHook(usePendingRemovals);
  await act(() => scheduleRemoval(item));
  expect(view.result.current).toEqual([{ ...item, status: 'undoable' }]);
  await act(() => jest.advanceTimersByTime(5000));
  await act(() => undoRemoval(item));
  await act(() => jest.advanceTimersByTime(6000));
  expect(softDeleteSavedWork).not.toHaveBeenCalled();
  expect(view.result.current).toEqual([]);
});
it('commits to the original owner and exposes a failed removal for retry', async () => {
  const item = { owner: 'account:original', localId: 'retry', title: 'Irises' };
  jest.mocked(softDeleteSavedWork).mockRejectedValueOnce(new Error('Disk full'));
  const view = await renderHook(usePendingRemovals);
  await act(() => scheduleRemoval(item));
  await act(() => jest.advanceTimersByTime(6000));
  expect(softDeleteSavedWork).toHaveBeenCalledWith('retry', expect.any(Number), 'account:original');
  expect(view.result.current[0].status).toBe('failed');
  await act(() => commitRemoval(view.result.current[0]));
  expect(view.result.current).toEqual([]);
});
it('commits undoable removals when the app leaves the foreground instead of waiting for the timer', async () => {
  const item = { owner: 'account:a', localId: 'background', title: 'Haystacks' };
  const view = await renderHook(usePendingRemovals);
  await act(() => scheduleRemoval(item));
  await act(() => appStateListener?.('background'));
  expect(softDeleteSavedWork).toHaveBeenCalledWith('background', expect.any(Number), 'account:a');
  expect(view.result.current).toEqual([]);
  await act(() => jest.advanceTimersByTime(6000));
  expect(softDeleteSavedWork).toHaveBeenCalledTimes(1);
});
