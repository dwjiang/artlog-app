import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AccessibilityInfo, AppState, DeviceEventEmitter, Linking, type AppStateStatus } from 'react-native';

import { ScanScreen } from './scan-screen';
import type { CaptureState } from '@/lib/capture/capture-controller';
import type { CaptureTimings } from '@/lib/capture/stages';
import type { VenueView } from '@/lib/venue/use-venue';

let mockFocused = true;
let mockGranted = true;
let mockCanRequest = false;
let mockState: CaptureState = { phase: 'searching', occupied: false };
let mockOnDetection: (detection: unknown) => void;
let mockTimings: CaptureTimings | undefined;
let mockMessage: string | undefined;
let mockPending = 0;
let mockVenueView: VenueView;
let mockCameraProps: { isActive: boolean; outputs: unknown[]; orientationSource?: string; allowHapticsAndSystemSoundsPlayback?: boolean; onStarted: () => void; onError: () => void };
let appStateListener: (state: AppStateStatus) => void;
const mockRequest = jest.fn();
const mockPhoto = jest.fn();
const mockCapture = jest.fn();
const mockCaptureAutomatically = jest.fn();
const mockImport = jest.fn();
const mockClearMessage = jest.fn();
const mockPush = jest.fn();
const mockSelectionHaptic = jest.fn();
const mockImpactHaptic = jest.fn();
const mockObserve = jest.fn();
const mockResolveVenue = jest.fn();
const mockSetParams = jest.fn();
let mockParams: { visitId?: string } = {};
let mockTabsListener: ((event: { data: { state: { index: number; routes: { name: string }[] } } }) => void) | undefined;
let mockVisitUnavailable: (() => void) | undefined;
const mockFrameOutput = { kind: 'frame-output' };
const mockDetectorActive: boolean[] = [];

jest.mock('@/components/collection/gallery-button');
jest.mock('./capture-context-button', () => ({ CaptureContextButton: () => null }));
jest.mock('@expo/ui', () => {
  const { Pressable, Text, View } = jest.requireActual('react-native');
  return {
    Host: View,
    Row: View,
    Button: ({ label, onPress }: { label: string; onPress: () => void }) => (
      <Pressable accessibilityRole="button" onPress={onPress}><Text>{label}</Text></Pressable>
    ),
  };
});
jest.mock('expo-router', () => ({ useLocalSearchParams: () => mockParams, useRouter: () => ({ push: mockPush }), useNavigation: () => ({
  addListener: () => () => {}, setParams: (...args: unknown[]) => mockSetParams(...args),
  getParent: () => ({ addListener: (_event: string, listener: typeof mockTabsListener) => { mockTabsListener = listener; return () => { mockTabsListener = undefined; }; } }),
}) }));
jest.mock('./capture-visit-pill', () => ({ CaptureVisitPill: ({ visitId }: { visitId: string }) => {
  const { Text } = jest.requireActual('react-native'); return <Text>Adding to {visitId}</Text>;
} }));
jest.mock('expo-router/react-navigation', () => ({ useIsFocused: () => mockFocused }));
jest.mock('@/db/client', () => ({ db: jest.requireActual('../../db/test-db').createTestDatabase() }));
jest.mock('expo-haptics', () => ({
  selectionAsync: () => mockSelectionHaptic(),
  impactAsync: (style: string) => mockImpactHaptic(style),
  ImpactFeedbackStyle: { Light: 'light' },
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 60, bottom: 34 }) }));
jest.mock('react-native-vision-camera', () => ({
  useCameraPermission: () => ({ hasPermission: mockGranted, canRequestPermission: mockCanRequest, requestPermission: mockRequest }),
  usePhotoOutput: () => ({ capturePhotoToFile: mockPhoto }),
  Camera: (props: typeof mockCameraProps): ReactNode => { mockCameraProps = props; return null; },
}));
jest.mock('@/lib/capture/use-capture', () => ({
  useCapture: (options: { onVisitUnavailable?: () => void }) => {
    mockVisitUnavailable = options.onVisitUnavailable;
    return {
      state: { ...mockState, message: mockMessage }, controller: { observe: mockObserve },
      captureManually: mockCapture, captureAutomatically: mockCaptureAutomatically, importPhoto: mockImport, timings: mockTimings, useCamera: mockClearMessage,
    };
  },
}));
jest.mock('@/lib/venue/use-venue', () => ({ resolveVenueForScan: () => mockResolveVenue(), useVenue: () => mockVenueView }));
jest.mock('@/lib/queue/use-queue', () => ({ useQueue: () => ({ pending: mockPending, items: Array.from({ length: mockPending }, () => ({ status: 'queued' })) }) }));
jest.mock('@/lib/capture/use-rect-detector', () => ({
  useRectDetector: (active: boolean, callback: (detection: unknown) => void) => {
    mockOnDetection = callback;
    mockDetectorActive.push(active);
    return mockFrameOutput;
  },
}));
jest.mock('./capture-reveal', () => ({ CaptureReveal: () => null }));

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(AccessibilityInfo, 'isReduceTransparencyEnabled').mockResolvedValue(false);
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation((event, listener) => DeviceEventEmitter.addListener(event, listener));
  mockFocused = true;
  mockParams = {};
  mockTabsListener = undefined;
  mockGranted = true;
  mockCanRequest = false;
  mockState = { phase: 'searching', occupied: false };
  mockTimings = undefined;
  mockMessage = undefined;
  mockPending = 0;
  mockVenueView = {
    status: 'resolved', venue: { kind: 'seeded', venueId: 'museum-1' as never, name: 'Legion of Honor' }, options: [],
    resolve: jest.fn(), confirm: jest.fn(), dismiss: jest.fn(), end: jest.fn(),
  };
  mockDetectorActive.length = 0;
  AppState.currentState = 'active';
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    appStateListener = listener;
    return { remove: jest.fn() };
  });
  mockPhoto.mockResolvedValue({ filePath: '/photo.jpg' });
  mockSelectionHaptic.mockResolvedValue(undefined);
  mockImpactHaptic.mockResolvedValue(undefined);
  mockRequest.mockResolvedValue(true);
  mockImport.mockResolvedValue(undefined);
  mockObserve.mockReturnValue(undefined);
  mockResolveVenue.mockResolvedValue({ venueId: 'museum-1', visitId: 'visit-1', visitLocalId: 'local-visit' });
  mockCapture.mockImplementation(async (takePhoto: () => Promise<unknown>) => takePhoto());
  mockCaptureAutomatically.mockImplementation(async (_attempt: unknown, takePhoto: () => Promise<unknown>) => takePhoto());
});
afterEach(() => jest.restoreAllMocks());

it('waits until Scan is active before asking for camera access', async () => {
  mockFocused = false; mockGranted = false; mockCanRequest = true;
  const view = await render(<ScanScreen />);
  expect(mockRequest).not.toHaveBeenCalled();
  mockFocused = true;
  await view.rerender(<ScanScreen />);
  expect(mockRequest).toHaveBeenCalledTimes(1);
});

it('streams frames to the detector and shows automatic scan guidance without a label button', async () => {
  await render(<ScanScreen />);
  expect(mockCameraProps.outputs).toContain(mockFrameOutput);
  await act(() => mockCameraProps.onStarted());
  expect(screen.getByText('Point at an artwork. Hold steady to scan.')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Scan label' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Import' })).toBeEnabled();
  expect(mockCameraProps.orientationSource).toBe('interface');
  expect(mockCameraProps.allowHapticsAndSystemSoundsPlayback).toBe(true);
});

it('takes a still only when the controller accepts a detection', async () => {
  const attempt = { source: 'camera', quad: [[0.1, 0.2], [0.9, 0.2], [0.9, 0.8], [0.1, 0.8]], valid: true };
  await render(<ScanScreen />);
  await act(() => mockCameraProps.onStarted());
  await act(() => mockOnDetection({}));
  expect(mockPhoto).not.toHaveBeenCalled();
  mockObserve.mockReturnValue(attempt);
  await act(() => mockOnDetection({}));
  expect(mockCaptureAutomatically).toHaveBeenCalledWith(attempt, expect.any(Function));
  expect(mockPhoto).toHaveBeenCalledWith({}, {});
  expect(mockCapture).not.toHaveBeenCalled();
});

it('announces camera startup errors, keeps import available, and clears the error on recovery', async () => {
  await render(<ScanScreen />);
  await act(() => mockCameraProps.onError());
  expect(screen.getByRole('alert')).toHaveTextContent('Could not start the camera. You can import a photo.');
  expect(screen.getByRole('button', { name: 'Scan artwork' })).toBeDisabled();
  await fireEvent.press(screen.getByRole('button', { name: 'Import' }));
  expect(mockImport).toHaveBeenCalledTimes(1);

  await act(() => mockCameraProps.onStarted());
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByText('Point at an artwork. Hold steady to scan.')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Scan artwork' })).toBeEnabled();
});

it('hides camera startup errors while an imported photo is processing or needs a retry', async () => {
  const view = await render(<ScanScreen />);
  await act(() => mockCameraProps.onError());

  mockState = { phase: 'processing', occupied: true, source: 'library' };
  await view.rerender(<ScanScreen />);
  expect(screen.queryByText('Could not start the camera. You can import a photo.')).toBeNull();
  expect(screen.getByText('Preparing painting…')).toBeOnTheScreen();

  mockState = { phase: 'retry', occupied: false, source: 'library' };
  mockMessage = 'Fit all corners';
  await view.rerender(<ScanScreen />);
  expect(screen.queryByText('Could not start the camera. You can import a photo.')).toBeNull();
  expect(screen.getByRole('alert')).toHaveTextContent('Fit all corners');
  expect(screen.getByRole('button', { name: 'Choose another photo' })).toBeEnabled();
});

it('keeps the shutter as a manual fallback once the camera is ready', async () => {
  await render(<ScanScreen />);
  expect(screen.getByRole('button', { name: 'Scan artwork' })).toBeDisabled();
  await act(() => mockCameraProps.onStarted());
  await fireEvent.press(screen.getByRole('button', { name: 'Scan artwork' }));
  expect(mockCapture).toHaveBeenCalledWith(expect.any(Function));
  expect(mockPhoto).toHaveBeenCalledTimes(1);
  expect(mockPhoto).toHaveBeenCalledWith({}, {});
});

it('pauses the camera and detector when another screen is focused or the app backgrounds', async () => {
  const view = await render(<ScanScreen />);
  await act(() => mockCameraProps.onStarted());
  expect(mockCameraProps.isActive).toBe(true);
  expect(mockDetectorActive.at(-1)).toBe(true);
  mockFocused = false;
  await view.rerender(<ScanScreen />);
  expect(mockCameraProps.isActive).toBe(false);
  expect(mockDetectorActive.at(-1)).toBe(false);
  mockFocused = true;
  await view.rerender(<ScanScreen />);
  await act(() => appStateListener('background'));
  expect(mockCameraProps.isActive).toBe(false);
  expect(mockDetectorActive.at(-1)).toBe(false);
});

it.each(['processing', 'revealing', 'result'] as const)('pauses scanning and imports during %s', async (phase) => {
  mockState = { phase, occupied: phase !== 'result', source: 'camera' };
  await render(<ScanScreen />);
  await act(() => mockCameraProps.onStarted());
  expect(mockCameraProps.isActive).toBe(false);
  expect(mockDetectorActive.at(-1)).toBe(false);
  expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Scan artwork' })).toBeDisabled();
  if (phase === 'revealing') expect(screen.getByText('Recognizing artwork…')).toBeOnTheScreen();
});

it('keeps import available after camera permission denial', async () => {
  mockGranted = false;
  mockCanRequest = true;
  const view = await render(<ScanScreen />);
  expect(mockRequest).toHaveBeenCalledTimes(1);
  mockCanRequest = false;
  await view.rerender(<ScanScreen />);
  const open = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
  await fireEvent.press(screen.getByRole('button', { name: 'Open Settings' }));
  expect(open).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByRole('button', { name: 'Import' }));
  expect(mockImport).toHaveBeenCalledTimes(1);
});

it('keeps the venue and queue controls', async () => {
  mockPending = 2;
  await render(<ScanScreen />);
  await fireEvent.press(screen.getByRole('button', { name: 'Legion of Honor' }));
  expect(mockPush).toHaveBeenCalledWith('/venue-picker');
  expect(screen.getByLabelText('Recent scans, 2 scans')).toBeOnTheScreen();
});

it('shows corrective guidance and keeps detecting after a camera failure', async () => {
  mockMessage = 'Dodge the glare';
  mockState = { phase: 'retry', source: 'camera', occupied: false, rearm: 'reframe' };
  await render(<ScanScreen />);
  await act(() => mockCameraProps.onStarted());
  expect(screen.getByRole('alert')).toHaveTextContent(/Dodge the glare/);
  expect(screen.getByText('Move the camera to reframe, then hold steady.')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Retake' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Scan artwork' })).toBeEnabled();
  expect(mockDetectorActive.at(-1)).toBe(true);
});

it('asks for another shutter press after a shutter failure, which holding steady cannot rescan', async () => {
  mockMessage = 'Dodge the glare';
  mockState = { phase: 'retry', source: 'camera', occupied: false, rearm: 'shutter' };
  await render(<ScanScreen />);
  await act(() => mockCameraProps.onStarted());
  expect(screen.getByRole('alert')).toHaveTextContent(/Dodge the glare/);
  expect(screen.getByText('Reframe the artwork and tap the shutter.')).toBeOnTheScreen();
  expect(screen.queryByText('Move the camera to reframe, then hold steady.')).toBeNull();
});

it('offers both explicit actions after a failed import and keeps scanning paused', async () => {
  mockMessage = 'Fit all corners';
  mockState = { phase: 'retry', source: 'library', occupied: false };
  await render(<ScanScreen />);
  expect(mockDetectorActive.at(-1)).toBe(false);
  await fireEvent.press(screen.getByRole('button', { name: 'Choose another photo' }));
  expect(mockImport).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByRole('button', { name: 'Use camera' }));
  expect(mockClearMessage).toHaveBeenCalledTimes(1);
});

it('shows the stage breakdown of the last capture in development', async () => {
  mockTimings = { warp: 273.4, triage: 8.6, embed: 480.2, orb: 11.7, identify: 38.1, total: 812.0 };
  await render(<ScanScreen />);
  expect(screen.getByText('Capture 812 ms · warp 273 · triage 9 · embed 480 · orb 12 · identify 38')).toBeOnTheScreen();
});

it('keeps a chosen visit through sheets above the tab and drops it at the result or on a tab change', async () => {
  mockParams = { visitId: 'paris' };
  const view = await render(<ScanScreen />);
  expect(screen.getByText('Adding to paris')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Legion of Honor' })).toBeNull();
  mockFocused = false;
  await view.rerender(<ScanScreen />);
  expect(mockSetParams).not.toHaveBeenCalled();
  await act(async () => mockTabsListener?.({ data: { state: { index: 1, routes: [{ name: '(home)' }, { name: '(scan)' }, { name: '(collection)' }] } } }));
  expect(mockSetParams).not.toHaveBeenCalled();
  await act(async () => mockTabsListener?.({ data: { state: { index: 2, routes: [{ name: '(home)' }, { name: '(scan)' }, { name: '(collection)' }] } } }));
  expect(mockSetParams).toHaveBeenCalledWith({ visitId: undefined });
  mockSetParams.mockClear(); mockFocused = true;
  mockState = { phase: 'result', occupied: true };
  await view.rerender(<ScanScreen />);
  expect(mockSetParams).toHaveBeenCalledWith({ visitId: undefined });
  mockSetParams.mockClear();
  mockVisitUnavailable?.();
  expect(mockSetParams).toHaveBeenCalledWith({ visitId: undefined });
});
