import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AppState, Linking, type AppStateStatus } from 'react-native';

import { ScanScreen } from './scan-screen';
import type { CaptureInput } from '@/lib/capture/stages';

let mockFocused = true;
let mockGranted = true;
let mockCanRequest = false;
let mockCameraProps: { isActive: boolean; allowHapticsAndSystemSoundsPlayback?: boolean; onStarted: () => void };
let appStateListener: (state: AppStateStatus) => void;
const mockRequest = jest.fn();
const mockPhoto = jest.fn();
const mockCapture = jest.fn();
const mockImport = jest.fn();
const mockHaptic = jest.fn();

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
jest.mock('expo-haptics', () => ({ selectionAsync: () => mockHaptic() }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 60, bottom: 34 }) }));
jest.mock('react-native-vision-camera', () => ({
  useCameraPermission: () => ({ hasPermission: mockGranted, canRequestPermission: mockCanRequest, requestPermission: mockRequest }),
  usePhotoOutput: () => ({ capturePhotoToFile: mockPhoto }),
  Camera: (props: typeof mockCameraProps): ReactNode => { mockCameraProps = props; return null; },
}));
jest.mock('@/lib/capture/use-capture', () => ({
  useCapture: () => ({ capture: mockCapture, importPhoto: mockImport, busy: false }),
}));

beforeEach(() => {
  jest.resetAllMocks();
  mockFocused = true;
  mockGranted = true;
  mockCanRequest = false;
  AppState.currentState = 'active';
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    appStateListener = listener;
    return { remove: jest.fn() };
  });
  mockPhoto.mockResolvedValue({ filePath: '/photo.jpg' });
  mockHaptic.mockResolvedValue(undefined);
  mockRequest.mockResolvedValue(true);
  mockImport.mockResolvedValue(undefined);
  mockCapture.mockImplementation(async (getInput: () => Promise<CaptureInput>) => getInput());
});
afterEach(() => jest.restoreAllMocks());

it('gates the shutter on readiness and the stable-quad prop', async () => {
  const view = await render(<ScanScreen />);
  expect(screen.getByRole('button', { name: 'Take photo' })).toBeDisabled();
  await act(() => mockCameraProps.onStarted());
  expect(screen.getByRole('button', { name: 'Take photo' })).toBeEnabled();
  await view.rerender(<ScanScreen shutterEnabled={false} />);
  expect(screen.getByRole('button', { name: 'Take photo' })).toBeDisabled();
});

it('captures a URI and quad with a selection haptic', async () => {
  jest.spyOn(console, 'debug').mockImplementation(() => {});
  const quad: CaptureInput['quad'] = [[0, 0], [1, 0], [1, 1], [0, 1]];
  await render(<ScanScreen currentQuad={quad} />);
  expect(mockCameraProps.allowHapticsAndSystemSoundsPlayback).toBe(true);
  await act(() => mockCameraProps.onStarted());
  await fireEvent.press(screen.getByRole('button', { name: 'Take photo' }));
  expect(mockHaptic).toHaveBeenCalledTimes(1);
  expect(mockPhoto).toHaveBeenCalledWith({}, {});
  await expect(mockCapture.mock.results[0].value).resolves.toMatchObject({
    photoUri: 'file:///photo.jpg', quad, source: 'camera', capturedAt: expect.any(Number),
  });
});

it('pauses the camera when another tab is focused or the app backgrounds', async () => {
  const view = await render(<ScanScreen />);
  expect(mockCameraProps.isActive).toBe(true);
  mockFocused = false;
  await view.rerender(<ScanScreen />);
  expect(mockCameraProps.isActive).toBe(false);
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
