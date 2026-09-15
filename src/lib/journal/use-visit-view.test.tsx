import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useVisitView } from './use-visit-view';
const mockSettings = new Map<string, string>();
let mockPending: Promise<string | undefined> | undefined;
jest.mock('@/db/repos/settings', () => ({
  getSetting: (key: string) => mockPending ?? Promise.resolve(mockSettings.get(key)),
  setSetting: async (key: string, value: string) => { mockSettings.set(key, value); },
}));
afterEach(() => { mockPending = undefined; });
it('defaults to Globe once read and remembers the selection for its local owner', async () => {
  const first = await renderHook(() => useVisitView('a'));
  await waitFor(() => expect(first.result.current.mode).toBe('globe'));
  await act(() => first.result.current.changeMode('list')); await first.unmount();
  const restored = await renderHook(() => useVisitView('a'));
  await waitFor(() => expect(restored.result.current.mode).toBe('list')); await restored.unmount();
  const other = await renderHook(() => useVisitView('b'));
  await waitFor(() => expect(other.result.current.mode).toBe('globe'));
});
it('reports no mode until the preference is read, unless the user picks one first', async () => {
  mockPending = new Promise(() => {});
  const view = await renderHook(() => useVisitView('c'));
  expect(view.result.current.mode).toBeUndefined();
  await act(() => view.result.current.changeMode('list'));
  expect(view.result.current.mode).toBe('list');
});
