import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { router, useLocalSearchParams } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { AppState, Text } from 'react-native';

import { LocalScanScreen } from '@/components/scan/local-scan-screen';
import { QueueSheet } from '@/components/scan/states/queue-sheet';
jest.mock('./capture-photos-button', () => ({ CapturePhotosButton: () => null }));

let mockRows: { owner: string; localId: string; status: 'queued' | 'identified'; cropPath: string; capturedAt?: number; scanId?: string }[] = [];
const mockListeners = new Set<() => void>();
beforeEach(() => { AppState.currentState = 'active'; });
afterEach(() => jest.useRealTimers());
jest.mock('drizzle-orm/expo-sqlite', () => ({
  useLiveQuery: () => {
    const React = jest.requireActual('react');
    const data = React.useSyncExternalStore((listener: () => void) => {
      mockListeners.add(listener);
      return () => mockListeners.delete(listener);
    }, () => mockRows);
    return { data, updatedAt: new Date() };
  },
}));
jest.mock('@/db/repos/pending-scans', () => ({ selectPendingScan: jest.fn(), pendingScansQuery: jest.fn() }));
jest.mock('@/lib/files/photos', () => ({ captureFileUri: (path: string) => `file:///documents/${path}` }));
jest.mock('@/lib/queue/queue', () => ({ retryPendingScan: jest.fn() }));
jest.mock('@/lib/result/use-save-result', () => ({ useSaveResult: () => ({ saving: false, save: jest.fn() }) }));
jest.mock('@expo/ui', () => {
  const { Pressable, Text, TextInput, View } = jest.requireActual('react-native');
  return {
    Host: View,
    Button: ({ label, onPress }: { label: string; onPress: () => void }) => <Pressable accessibilityRole="button" onPress={onPress}><Text>{label}</Text></Pressable>,
    TextInput,
  };
});

function ResultRoute() {
  const { scanId } = useLocalSearchParams<{ scanId: string }>();
  return scanId.startsWith('local-') ? <LocalScanScreen localId={scanId.slice(6)} /> : <Text>Server result {scanId}</Text>;
}

it('keeps label capture open on completion and shows the result when returning', async () => {
  mockRows = [{ owner: 'device:test-installation', localId: 'one', status: 'queued', cropPath: 'crops/one.jpg' }];
  const view = renderRouter({
    _layout: () => <Stack />,
    index: () => <Text>Camera</Text>,
    'result/[scanId]': ResultRoute,
    'label/[scanId]': () => <Text>Label capture</Text>,
  }, { initialUrl: '/' });
  await view;
  await act(() => router.push('/result/local-one'));
  await fireEvent.press(await screen.findByRole('button', { name: 'Point at the label' }));
  await waitFor(() => expect(view.getPathname()).toBe('/label/local-one'));
  await act(() => {
    mockRows = [{ ...mockRows[0], status: 'identified', scanId: 'server-one' }];
    mockListeners.forEach((listener) => listener());
  });
  expect(view.getPathname()).toBe('/label/local-one');
  expect(screen.getByText('Label capture')).toBeOnTheScreen();
  await act(() => router.back());
  await waitFor(() => expect(view.getPathname()).toBe('/result/server-one'));
  await act(() => router.back());
  expect(view.getPathname()).toBe('/');
});

it('checks opening a row from the root queue sheet leaves one underlying stack', async () => {
  mockRows = [{ owner: 'device:test-installation', localId: 'one', status: 'queued', cropPath: 'crops/one.jpg', capturedAt: Date.now() }];
  const view = renderRouter({
    _layout: { default: () => <Stack />, unstable_settings: { anchor: '(tabs)' } },
    '(tabs)/_layout': () => <Stack />,
    '(tabs)/index': () => <Text>Camera</Text>,
    '(tabs)/result/[scanId]': ResultRoute,
    '(tabs)/label/[scanId]': () => <Text>Label capture</Text>,
    queue: QueueSheet,
  }, { initialUrl: '/' });
  await view;
  await act(() => router.push('/queue'));
  await fireEvent.press(await screen.findByRole('button', { name: /Scan from/ }));
  await waitFor(() => expect(view.getPathname()).toBe('/result/local-one'));
  const root = view.getRouterState()!.routes[0].state!;
  expect(root.routes.map((route) => route.name)).toEqual(['(tabs)']);
});
