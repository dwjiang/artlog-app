import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AppState, Linking, type AppStateStatus } from 'react-native';

import { ScanScreen } from './scan-screen';
import type { CaptureState } from '@/lib/capture/capture-controller';
import type { CaptureTimings } from '@/lib/capture/stages';
import type { VenueView } from '@/lib/venue/use-venue';

let mockFocused = true;
let mockGranted = true;
let mockCanRequest = false;
let mockState: CaptureState = { phase: 'searching', occupied: false };
let mockTimings: CaptureTimings | undefined;
let mockMessage: string | undefined;
let mockPending = 0;
let mockVenueView: VenueView;
let mockCameraProps: { isActive: boolean; outputs: unknown[]; orientationSource?: string; allowHapticsAndSystemSoundsPlayback?: boolean; onStarted: () => void };
let appStateListener: (state: AppStateStatus) => void;
const mockRequest = jest.fn();
const mockPhoto = jest.fn();
const mockCapture = jest.fn();
const mockImport = jest.fn();
const mockClearMessage = jest.fn();
const mockPush = jest.fn();
const mockSelectionHaptic = jest.fn();
const mockImpactHaptic = jest.fn();
const mockObserve = jest.fn();
const mockResolveVenue = jest.fn();

jest.mock('@/components/collection/gallery-button');
jest.mock('./capture-context-button', () => ({ CaptureContextButton: () => null }));
jest.mock('./capture-draft-banner', () => ({ CaptureDraftBanner: () => null }));
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
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }), useNavigation: () => ({ addListener: () => () => {} }) }));
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
  useCapture: () => ({ state: { ...mockState, message: mockMessage }, controller: { observe: mockObserve }, captureManually: mockCapture, importPhoto: mockImport, timings: mockTimings, useCamera: mockClearMessage }),
}));
jest.mock('@/lib/venue/use-venue', () => ({ resolveVenueForScan: () => mockResolveVenue(), useVenue: () => mockVenueView }));
jest.mock('@/lib/queue/use-queue', () => ({ useQueue: () => ({ pending: mockPending, items: Array.from({ length: mockPending }, () => ({ status: 'queued' })) }) }));
jest.mock('./capture-reveal', () => ({ CaptureReveal: () => null }));

beforeEach(() => {
  jest.resetAllMocks();
  mockFocused = true;
  mockGranted = true;
  mockCanRequest = false;
  mockState = { phase: 'searching', occupied: false };
  mockTimings = undefined;
  mockMessage = undefined;
  mockPending = 0;
  mockVenueView = {
    status: 'resolved', venue: { kind: 'seeded', venueId: 'museum-1' as never, name: 'Legion of Honor' }, options: [],
    resolve: jest.fn(), confirm: jest.fn(), dismiss: jest.fn(),
  };
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


it('waits for a ready camera and an explicit shutter press', async () => {
  await render(<ScanScreen />);
  expect(screen.getByRole('button', { name: 'Scan artwork' })).toBeDisabled();
  await act(() => mockCameraProps.onStarted());
  expect(mockPhoto).not.toHaveBeenCalled();
  expect(screen.getByText('Frame an artwork and tap the shutter.')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Scan artwork' }));
  expect(mockPhoto).toHaveBeenCalledTimes(1);
  expect(mockPhoto).toHaveBeenCalledWith({}, {});
  expect(mockCameraProps.orientationSource).toBe('interface');
  expect(mockCameraProps.allowHapticsAndSystemSoundsPlayback).toBe(true);
});

it('pauses the camera when another screen is focused or the app backgrounds', async () => {
  const view = await render(<ScanScreen />);
  await act(() => mockCameraProps.onStarted());
  expect(mockCameraProps.isActive).toBe(true);
  mockFocused = false;
  await view.rerender(<ScanScreen />);
  expect(mockCameraProps.isActive).toBe(false);
  mockFocused = true;
  await view.rerender(<ScanScreen />);
  await act(() => appStateListener('background'));
  expect(mockCameraProps.isActive).toBe(false);
});

it.each(['processing', 'revealing', 'result'] as const)('pauses scanning and imports during %s', async (phase) => {
  mockState = { phase, occupied: phase !== 'result', source: 'camera' };
  await render(<ScanScreen />);
  await act(() => mockCameraProps.onStarted());
  expect(mockCameraProps.isActive).toBe(false);
  expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
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
  expect(screen.getByLabelText('2 scans in queue')).toBeOnTheScreen();
});

it('shows corrective guidance and asks for reframing after a camera failure', async () => {
  mockMessage = 'Dodge the glare';
  mockState = { phase: 'retry', source: 'camera', occupied: false };
  await render(<ScanScreen />);
  await act(() => mockCameraProps.onStarted());
  expect(screen.getByRole('alert')).toHaveTextContent(/Dodge the glare/);
  expect(screen.getByText('Reframe the artwork and tap the shutter.')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Retake' })).toBeNull();
});

it('offers both explicit actions after a failed import and keeps scanning paused', async () => {
  mockMessage = 'Fit all corners';
  mockState = { phase: 'retry', source: 'library', occupied: false };
  await render(<ScanScreen />);
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

it('offers label scanning beside the shutter and captures it as label material', async () => {
  await render(<ScanScreen />);
  const label = screen.getByRole('button', { name: 'Scan label' });
  expect(label).toBeDisabled();
  await act(() => mockCameraProps.onStarted());
  await fireEvent.press(label);
  expect(mockCapture).toHaveBeenCalledWith(expect.any(Function), 'label');
  expect(mockPhoto).toHaveBeenCalledTimes(1);
});
