import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AppState, Linking, type AppStateStatus } from 'react-native';

import { ScanScreen } from './scan-screen';
import type { Guidance } from '@/lib/capture/rectangle';
import type { CaptureInput, CaptureTimings } from '@/lib/capture/stages';

let mockFocused = true;
let mockGranted = true;
let mockCanRequest = false;
let mockGuidance: Guidance = 'searching';
let mockTimings: CaptureTimings | undefined;
let mockCameraProps: { isActive: boolean; outputs: unknown[]; orientationSource?: string; allowHapticsAndSystemSoundsPlayback?: boolean; onStarted: () => void };
let appStateListener: (state: AppStateStatus) => void;
const mockRequest = jest.fn();
const mockPhoto = jest.fn();
const mockCapture = jest.fn();
const mockImport = jest.fn();
const mockSelectionHaptic = jest.fn();
const mockImpactHaptic = jest.fn();
const mockGetCaptureQuad = jest.fn();
const mockFrameOutput = { kind: 'frame-output' };
const mockDetectorActive: boolean[] = [];

jest.mock('@expo/ui', () => {
  const { Pressable, Text, View } = jest.requireActual('react-native');
  return {
    Host: View,
    Button: ({ label, onPress }: { label: string; onPress: () => void }) => (
      <Pressable accessibilityRole="button" onPress={onPress}><Text>{label}</Text></Pressable>
    ),
  };
});
jest.mock('expo-router/react-navigation', () => ({ useIsFocused: () => mockFocused }));
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));
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
  useCapture: () => ({ capture: mockCapture, importPhoto: mockImport, busy: false, timings: mockTimings }),
}));
jest.mock('@/lib/capture/use-rect-detector', () => ({
  useRectDetector: (active: boolean) => {
    mockDetectorActive.push(active);
    return { frameOutput: mockFrameOutput, liveQuad: { value: null }, guidance: mockGuidance, ready: mockGuidance === 'ready', getCaptureQuad: mockGetCaptureQuad };
  },
}));
jest.mock('./viewfinder-overlay', () => {
  const { Text } = jest.requireActual('react-native');
  return {
    ViewfinderOverlay: () => null,
    GuidanceLabel: ({ guidance }: { guidance: string }) => <Text>{`guidance:${guidance}`}</Text>,
  };
});

beforeEach(() => {
  jest.resetAllMocks();
  mockFocused = true;
  mockGranted = true;
  mockCanRequest = false;
  mockGuidance = 'searching';
  mockTimings = undefined;
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
  mockGetCaptureQuad.mockReturnValue(null);
  mockCapture.mockImplementation(async (getInput: () => Promise<CaptureInput>) => getInput());
});
afterEach(() => jest.restoreAllMocks());

it('enables the shutter once the camera runs, whatever the live outline says, with a haptic when it locks', async () => {
  const view = await render(<ScanScreen />);
  expect(mockCameraProps.outputs).toContain(mockFrameOutput);
  expect(screen.getByRole('button', { name: 'Take photo' })).toBeDisabled();
  await act(() => mockCameraProps.onStarted());
  expect(screen.getByRole('button', { name: 'Take photo' })).toBeEnabled();
  expect(screen.getByText('guidance:searching')).toBeOnTheScreen();
  mockGuidance = 'hold-still';
  await view.rerender(<ScanScreen />);
  expect(screen.getByRole('button', { name: 'Take photo' })).toBeEnabled();
  expect(mockImpactHaptic).not.toHaveBeenCalled();
  mockGuidance = 'ready';
  await view.rerender(<ScanScreen />);
  expect(mockImpactHaptic).toHaveBeenCalledWith('light');
  expect(screen.getByText('guidance:ready')).toBeOnTheScreen();
});

it('captures a URI and the unsmoothed capture quad in preview orientation with a selection haptic', async () => {
  jest.spyOn(console, 'debug').mockImplementation(() => {});
  const quad: CaptureInput['quad'] = [[0.1, 0.2], [0.9, 0.2], [0.9, 0.8], [0.1, 0.8]];
  mockGuidance = 'ready';
  mockGetCaptureQuad.mockReturnValue(quad);
  await render(<ScanScreen />);
  expect(mockCameraProps.orientationSource).toBe('interface');
  expect(mockCameraProps.allowHapticsAndSystemSoundsPlayback).toBe(true);
  await act(() => mockCameraProps.onStarted());
  await fireEvent.press(screen.getByRole('button', { name: 'Take photo' }));
  expect(mockSelectionHaptic).toHaveBeenCalledTimes(1);
  expect(mockPhoto).toHaveBeenCalledWith({}, {});
  await expect(mockCapture.mock.results[0].value).resolves.toMatchObject({
    photoUri: 'file:///photo.jpg', quad, source: 'camera', capturedAt: expect.any(Number),
  });
});

it('pauses the camera and detector when another tab is focused or the app backgrounds', async () => {
  const view = await render(<ScanScreen />);
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
});

it('requests camera permission on mount and keeps import available after denial', async () => {
  mockGranted = false;
  mockCanRequest = true;
  const view = await render(<ScanScreen />);
  expect(mockRequest).toHaveBeenCalledTimes(1);
  mockCanRequest = false;
  await view.rerender(<ScanScreen />);
  expect(screen.getByRole('button', { name: 'Open Settings' })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Take photo' })).toBeDisabled();
  const open = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
  await fireEvent.press(screen.getByRole('button', { name: 'Open Settings' }));
  expect(open).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByRole('button', { name: 'Import' }));
  expect(mockImport).toHaveBeenCalledTimes(1);
});

it('shows the stage breakdown of the last capture in development', async () => {
  mockTimings = { warp: 273.4, triage: 8.6, embed: 480.2, orb: 11.7, identify: 38.1, total: 812.0 };
  await render(<ScanScreen />);
  expect(screen.getByText('Capture 812 ms · warp 273 · triage 9 · embed 480 · orb 12 · identify 38')).toBeOnTheScreen();
});
