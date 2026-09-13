import { act, renderHook } from '@testing-library/react-native';

import { useCapture } from './use-capture';
import type { CaptureDependencies, CaptureInput, CapturePayload, CaptureResult } from './stages';

const mockIdentify = jest.fn();
const mockPush = jest.fn();
const mockPipeline = jest.fn();
const mockPermission = jest.fn();
const mockPicker = jest.fn();
const mockWarning = jest.fn();
const mockVenueIdAt = jest.fn();
let mockReachable: boolean | undefined = true;

jest.mock('convex/react', () => ({ useAction: () => mockIdentify }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('expo-network', () => ({ useNetworkState: () => ({ isInternetReachable: mockReachable }) }));
jest.mock('expo-haptics', () => ({
  notificationAsync: (...args: unknown[]) => mockWarning(...args), NotificationFeedbackType: { Warning: 'warning' },
}));
jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: () => mockPermission(), launchImageLibraryAsync: (...args: unknown[]) => mockPicker(...args),
}));
jest.mock('./pipeline', () => ({ runCapture: (...args: unknown[]) => mockPipeline(...args) }));
jest.mock('@/lib/venue/venue-db', () => ({ venueIdAt: (...args: unknown[]) => mockVenueIdAt(...args) }));
jest.mock('./default-stages', () => ({ captureOptions: { inputSize: 512, modelVersion: 'test' }, defaultStages: {} }));

const input: CaptureInput = { photoUri: 'file:///photo.jpg', quad: null, source: 'camera', capturedAt: 123 };

beforeEach(() => {
  jest.resetAllMocks();
  mockReachable = true;
  mockWarning.mockResolvedValue(undefined);
  mockPermission.mockResolvedValue({ granted: true });
  mockPipeline.mockResolvedValue({ kind: 'sent', scanId: 'scan-id', timings: { total: 12 } });
});

it.each([
  [{ kind: 'sent', scanId: 'scan-id' }, 'scan-id'],
  [{ kind: 'queued', localId: 'capture-uuid' }, 'local-capture-uuid'],
])('opens the matching result after capture: %s', async (result, scanId) => {
  mockPipeline.mockResolvedValue({ ...result, timings: { total: 12 } });
  const hook = await renderHook(useCapture);
  await act(async () => { await hook.result.current.capture(async () => input); });
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/result/[scanId]', params: { scanId } });
  expect(hook.result.current.timings).toEqual({ total: 12 });
  const deps = mockPipeline.mock.calls[0][1] as CaptureDependencies;
  const payload = { cropUri: 'file:///private.jpg', photoUri: 'file:///private-full.jpg', localId: 'capture-uuid', visitLocalId: 'local-visit' } as CapturePayload;
  await deps.identify(payload);
  expect(mockIdentify).toHaveBeenCalledWith({ localId: 'capture-uuid' });
});

it('shows retake guidance and a warning without navigating', async () => {
  mockPipeline.mockResolvedValue({ kind: 'retake', reason: 'blur', message: 'Hold steady', timings: { total: 2 } });
  const hook = await renderHook(useCapture);
  await act(async () => { await hook.result.current.capture(async () => input); });
  expect(hook.result.current.message).toBe('Hold steady');
  expect(mockWarning).toHaveBeenCalledWith('warning');
  expect(mockPush).not.toHaveBeenCalled();
  await act(() => hook.result.current.clearMessage());
  expect(hook.result.current.message).toBeUndefined();
});

it('requests photo permission only on import and preserves EXIF capture time', async () => {
  mockPicker.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///library.jpg', exif: { DateTimeOriginal: '2020:01:02 03:04:05' } }] });
  const hook = await renderHook(useCapture);
  expect(mockPermission).not.toHaveBeenCalled();
  await act(async () => { await hook.result.current.importPhoto(); });
  expect(mockPicker).toHaveBeenCalledWith({ mediaTypes: ['images'], exif: true, quality: 1 });
  expect(mockPipeline.mock.calls[0][0]).toEqual({
    photoUri: 'file:///library.jpg', quad: null, source: 'library', capturedAt: new Date(2020, 0, 2, 3, 4, 5).getTime(),
  });
  expect(mockVenueIdAt).not.toHaveBeenCalled();
});

it('names the venue of an imported photo from its EXIF position without starting a visit', async () => {
  mockPicker.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///library.jpg', exif: { GPSLatitude: 40.7794, GPSLatitudeRef: 'N', GPSLongitude: 73.9633, GPSLongitudeRef: 'W' } }] });
  mockVenueIdAt.mockResolvedValue('museum-met');
  const hook = await renderHook(useCapture);
  await act(async () => { await hook.result.current.importPhoto(); });
  expect(mockVenueIdAt).toHaveBeenCalledWith({ lat: 40.7794, lng: -73.9633 });
  expect(mockPipeline.mock.calls[0][0]).toMatchObject({ source: 'library', venueId: 'museum-met' });
  expect(mockPipeline.mock.calls[0][0]).not.toHaveProperty('visitId');
});

it('imports without a venue when the local table cannot be read', async () => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  mockPicker.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///library.jpg', exif: { GPSLatitude: 1, GPSLongitude: 2 } }] });
  mockVenueIdAt.mockRejectedValue(new Error('no table'));
  const hook = await renderHook(useCapture);
  await act(async () => { await hook.result.current.importPhoto(); });
  expect(mockPipeline.mock.calls[0][0]).toMatchObject({ source: 'library', venueId: undefined });
  expect(hook.result.current.message).toBeUndefined();
});

it('leaves the screen unchanged when the picker is canceled', async () => {
  mockPicker.mockResolvedValue({ canceled: true, assets: null });
  const hook = await renderHook(useCapture);
  await act(async () => { await hook.result.current.importPhoto(); });
  expect(mockPipeline).not.toHaveBeenCalled();
  expect(mockPush).not.toHaveBeenCalled();
  expect(hook.result.current.busy).toBe(false);
  expect(hook.result.current.message).toBeUndefined();
});

it('explains denied photo access without opening the picker', async () => {
  mockPermission.mockResolvedValue({ granted: false });
  const hook = await renderHook(useCapture);
  await act(async () => { await hook.result.current.importPhoto(); });
  expect(mockPicker).not.toHaveBeenCalled();
  expect(hook.result.current.message).toContain('Allow photo access in Settings');
});

it('blocks a second capture until the first finishes, then exposes errors for retry', async () => {
  let reject!: (error: Error) => void;
  mockPipeline.mockReturnValue(new Promise<CaptureResult>((_, fail) => { reject = fail; }));
  const hook = await renderHook(useCapture);
  const getInput = jest.fn(async () => input);
  let first!: Promise<void>;
  await act(async () => { first = hook.result.current.capture(getInput); });
  expect(hook.result.current.busy).toBe(true);
  await act(async () => { await hook.result.current.capture(getInput); });
  expect(getInput).toHaveBeenCalledTimes(1);
  await act(async () => { reject(new Error('Unable to correct the painting perspective')); await first; });
  expect(hook.result.current.busy).toBe(false);
  expect(hook.result.current.message).toBe('Unable to correct the painting perspective');
});

it('checks current reachability after processing, not the value at shutter press', async () => {
  const hook = await renderHook(useCapture);
  await act(async () => { await hook.result.current.capture(async () => input); });
  const deps = mockPipeline.mock.calls[0][1] as CaptureDependencies;
  expect(deps.isOnline()).toBe(true);
  mockReachable = false;
  await hook.rerender(undefined);
  expect(deps.isOnline()).toBe(false);
});

it('does not navigate after the screen unmounts during processing', async () => {
  let complete!: (result: CaptureResult) => void;
  mockPipeline.mockReturnValue(new Promise<CaptureResult>((resolve) => { complete = resolve; }));
  const hook = await renderHook(useCapture);
  let pending!: Promise<void>;
  await act(async () => { pending = hook.result.current.capture(async () => input); });
  await hook.unmount();
  await act(async () => { complete({ kind: 'queued', localId: 'id', timings: { total: 1 } }); await pending; });
  expect(mockPush).not.toHaveBeenCalled();
});
