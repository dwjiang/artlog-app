import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as SQLite from 'expo-sqlite';
import { Alert, AppState } from 'react-native';

import type { Id } from '../../../convex/_generated/dataModel';

import { LocalScanScreen, MISSING_TITLE } from './local-scan-screen';
import { RETRY_BUTTON } from './states/failed-card';
import { IDENTIFYING_TITLE, LABEL_NOW, WAITING_LINE, WAITING_TITLE } from './states/waiting-for-signal-card';
import { enqueuePendingScan, markIdentified, markIdentifying, retryPendingScan } from '@/db/repos/pending-scans';
import * as resultSave from '@/lib/result/save';
import { getSavedWork } from '@/db/repos/saved-works';
import type { NewPendingScan } from '@/db/schema';
import { FAILED_TITLE } from '@/lib/result/failure-copy';
jest.mock('./capture-context-button', () => ({ CaptureContextButton: () => null }));
jest.mock('../collection/gallery-button', () => ({ GalleryButton: ({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) => { const { Pressable, Text } = jest.requireActual('react-native'); return <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress}><Text>{label}</Text></Pressable>; } }));
jest.mock('./capture-photos-button', () => ({ CapturePhotosButton: () => null }));

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockRetry = jest.fn();
const mockMutation = jest.fn();
const mockHaptic = jest.fn();
let mockUuid = 0;
let mockFocused = true;
const databaseListeners = new Set<Parameters<typeof SQLite.addDatabaseChangeListener>[0]>();

jest.mock('@/db/client', () => ({ db: jest.requireActual('../../db/test-db').createTestDatabase() }));
jest.mock('@/lib/files/photos', () => ({ captureFileUri: (path: string) => `file:///documents/${path}` }));
jest.mock('@/lib/venue/venue-db', () => ({ venueNameById: async () => 'Legion of Honor' }));
jest.mock('@/lib/queue/queue', () => ({ retryPendingScan: (localId: string) => mockRetry(localId) }));
jest.mock('@/lib/convex-client', () => ({
  convex: { mutation: (fn: unknown, args: unknown) => mockMutation(jest.requireActual('convex/server').getFunctionName(fn), args) },
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => `saved-${++mockUuid}` }));
jest.mock('expo-router/react-navigation', () => ({ useIsFocused: () => mockFocused }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, navigate: mockPush, replace: mockReplace }) }));
jest.mock('expo-haptics', () => ({
  notificationAsync: (type: string) => mockHaptic(type),
  NotificationFeedbackType: { Success: 'success' },
}));
jest.mock('@expo/ui', () => {
  const { Pressable, Text, TextInput, View } = jest.requireActual('react-native');
  return {
    Host: View,
    Button: ({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) => (
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress}><Text>{label}</Text></Pressable>
    ),
    TextInput: ({ defaultValue, placeholder, editable, onChangeText }: { defaultValue?: string; placeholder?: string; editable?: boolean; onChangeText?: (value: string) => void }) => (
      <TextInput accessibilityLabel={placeholder} placeholder={placeholder} defaultValue={defaultValue} editable={editable} onChangeText={onChangeText} />
    ),
  };
});

function row(localId: string, fields: Partial<NewPendingScan>): NewPendingScan {
  return {
    localId, photoPath: `photos/${localId}.jpg`, cropPath: `crops/${localId}.jpg`, vector: [0.1], descriptors: new ArrayBuffer(0), keypoints: new ArrayBuffer(0),
    modelVersion: 'm', attemptModelVersion: 'm', venueId: 'museum-legion' as Id<'museums'>, capturedAt: 1, createdAt: 1, ...fields,
  };
}

beforeAll(async () => {
  await enqueuePendingScan(row('cap-queued', { status: 'queued' }));
  await enqueuePendingScan(row('cap-flight', { status: 'identifying' }));
  await enqueuePendingScan(row('cap-failed', { status: 'failed', lastError: 'bad_features', attempts: 5 }));
  await enqueuePendingScan(row('cap-done', { status: 'identified', scanId: 'scan-9' as Id<'scans'> }));
  await enqueuePendingScan(row('cap-old', { status: 'failed', lastError: 'Update the app to identify.', scanId: 'scan-u' as Id<'scans'> }));
});

beforeEach(() => {
  mockFocused = true;
  jest.clearAllMocks();
  AppState.currentState = 'active';
  databaseListeners.clear();
  jest.spyOn(SQLite, 'addDatabaseChangeListener').mockImplementation((listener) => {
    databaseListeners.add(listener);
    return { remove: () => { databaseListeners.delete(listener); } };
  });
  mockRetry.mockResolvedValue(undefined);
  mockMutation.mockResolvedValue({ collectionId: 'col-1', updatedAt: 20, updatedBy: 'device' });
  mockHaptic.mockResolvedValue(undefined);
});
afterEach(() => jest.restoreAllMocks());

async function complete(localId: string) {
  await act(async () => {
    await markIdentified(localId, `scan-${localId}` as Id<'scans'>);
    for (const listener of databaseListeners) {
      listener({ tableName: 'pendingScans', databaseName: 'artlog.db', databaseFilePath: '', rowId: 1 });
    }
  });
}

it('keeps a manual draft on completion, then saves it before opening the result', async () => {
  await enqueuePendingScan(row('draft-completion', { status: 'queued' }));
  const alert = jest.spyOn(Alert, 'alert');
  await render(<LocalScanScreen localId="draft-completion" />);
  await fireEvent.changeText(await screen.findByLabelText('Title'), 'Pond at dusk');
  await fireEvent.changeText(screen.getByLabelText('Artist'), 'My artist');
  await complete('draft-completion');
  expect(mockReplace).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Title').props.defaultValue).toBe('Pond at dusk');
  expect(screen.getByLabelText('Artist').props.defaultValue).toBe('My artist');
  await fireEvent.press(screen.getByRole('button', { name: 'View result' }));
  expect(alert).toHaveBeenCalledWith('Discard your edits?', expect.any(String), expect.any(Array));
  expect(mockReplace).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Save anyway' }));
  await screen.findByText(/^(View artwork|Saved · View in collection)$/);
  expect(await getSavedWork(`saved-${mockUuid}`)).toMatchObject({ title: 'Pond at dusk', artist: 'My artist' });
  await fireEvent.press(screen.getByRole('button', { name: 'View result' }));
  expect(mockReplace).toHaveBeenCalledWith({ pathname: '/result/[scanId]', params: { scanId: 'scan-draft-completion' } });
});

it('finishes an in-flight save when identification completes and keeps the saved link', async () => {
  await enqueuePendingScan(row('saving-completion', { status: 'queued' }));
  let finishWrite!: () => void;
  const pendingWrite = new Promise<void>((resolve) => { finishWrite = resolve; });
  const save = resultSave.saveResult;
  jest.spyOn(resultSave, 'saveResult').mockImplementationOnce(async (input) => {
    await pendingWrite;
    return save(input);
  });
  await render(<LocalScanScreen localId="saving-completion" />);
  await fireEvent.changeText(await screen.findByLabelText('Title'), 'My saved title');
  await fireEvent.press(screen.getByRole('button', { name: 'Save anyway' }));
  await screen.findByText('Saving…');
  await complete('saving-completion');
  expect(mockReplace).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'View result' })).toBeDisabled();
  await act(() => { finishWrite(); });
  await screen.findByText(/^(View artwork|Saved · View in collection)$/);
  expect(await getSavedWork(`saved-${mockUuid}`)).toMatchObject({ title: 'My saved title' });
  expect(screen.getByRole('button', { name: 'View result' })).toBeEnabled();
  expect(mockReplace).not.toHaveBeenCalled();
});

it('opens a ready result after the user explicitly discards the draft', async () => {
  await enqueuePendingScan(row('discard-completion', { status: 'queued' }));
  const alert = jest.spyOn(Alert, 'alert');
  await render(<LocalScanScreen localId="discard-completion" />);
  await fireEvent.changeText(await screen.findByLabelText('Title'), 'Unsaved title');
  await complete('discard-completion');
  await fireEvent.press(screen.getByRole('button', { name: 'View result' }));
  expect(mockReplace).not.toHaveBeenCalled();
  const discard = alert.mock.calls[0][2]?.find((button) => button.text === 'Discard edits');
  expect(discard).toBeDefined();
  await act(() => discard?.onPress?.());
  expect(mockReplace).toHaveBeenCalledWith({ pathname: '/result/[scanId]', params: { scanId: 'scan-discard-completion' } });
});

it('shows the queued capture as waiting for signal, sends the label offline and saves anyway with a typed title', async () => {
  await render(<LocalScanScreen localId="cap-queued" />);
  expect(await screen.findByText(WAITING_TITLE)).toBeOnTheScreen();
  expect(screen.getByText(WAITING_LINE)).toBeOnTheScreen();
  expect(screen.getByLabelText('Your photo of this painting').props.source).toEqual([{ uri: 'file:///documents/crops/cap-queued.jpg' }]);
  await fireEvent.press(screen.getByRole('button', { name: LABEL_NOW }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/label/[scanId]', params: { scanId: 'local-cap-queued', offline: '1' } });
  expect(screen.getByRole('button', { name: 'Save anyway' })).toBeEnabled();
  await fireEvent.changeText(screen.getByLabelText('Title'), 'Pond at dusk');
  await fireEvent.press(screen.getByRole('button', { name: 'Save anyway' }));
  const link = await screen.findByText(/^(View artwork|Saved · View in collection)$/);
  const savedId = `saved-${mockUuid}`;
  expect(await getSavedWork(savedId)).toMatchObject({
    title: 'Pond at dusk', artist: '', cropPath: 'crops/cap-queued.jpg', photoPath: 'photos/cap-queued.jpg', scanId: null, venueId: 'museum-legion', venueName: 'Legion of Honor',
  });
  await waitFor(() => expect(mockMutation).toHaveBeenCalledWith('collections:saveToCollection', expect.objectContaining({ localId: savedId, suggested: null })));
  expect(mockMutation.mock.calls[0][1].scanId).toBeUndefined();
  expect(mockHaptic).toHaveBeenCalledWith('success');
  expect(screen.queryByLabelText('Title')).toBeNull();
  expect(screen.getByText('Saved as Pond at dusk.')).toBeOnTheScreen();
  await fireEvent.press(link);
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/saved/[savedId]', params: { savedId } });
  expect(mockReplace).not.toHaveBeenCalled();
});

it('reads as identifying while the flusher has the capture in flight', async () => {
  await render(<LocalScanScreen localId="cap-flight" />);
  expect(await screen.findByText(IDENTIFYING_TITLE)).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: LABEL_NOW })).toBeOnTheScreen();
});

it.each([
  ['queued', WAITING_TITLE],
  ['identifying', IDENTIFYING_TITLE],
] as const)('keeps an unsupported retry local while %s, then opens the completed result', async (status, title) => {
  const localId = `unsupported-retry-${status}`;
  const scanId = `scan-${localId}` as Id<'scans'>;
  await enqueuePendingScan(row(localId, { status: 'failed', scanId, lastError: 'Update the app to identify.' }));
  await retryPendingScan(localId);
  if (status === 'identifying') await markIdentifying(localId);

  await render(<LocalScanScreen localId={localId} />);
  expect(await screen.findByText(title)).toBeOnTheScreen();
  expect(mockReplace).not.toHaveBeenCalled();
  expect(screen.queryByText('Your result is ready')).toBeNull();
  expect(screen.queryByRole('button', { name: 'View result' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Save anyway' })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: LABEL_NOW }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/label/[scanId]', params: { scanId: `local-${localId}`, offline: '1' } });

  await complete(localId);
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith({ pathname: '/result/[scanId]', params: { scanId } }));
});

it('saves a manual entry during an unsupported retry without presenting the old result as ready', async () => {
  const localId = 'unsupported-retry-save';
  const scanId = `scan-${localId}` as Id<'scans'>;
  await enqueuePendingScan(row(localId, { status: 'failed', scanId, lastError: 'Update the app to identify.' }));
  await retryPendingScan(localId);

  await render(<LocalScanScreen localId={localId} />);
  await fireEvent.changeText(await screen.findByLabelText('Title'), 'My painting');
  expect(screen.getByText(WAITING_TITLE)).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'View result' })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Save anyway' }));
  await screen.findByText(/^(View artwork|Saved · View in collection)$/);
  expect(await getSavedWork(`saved-${mockUuid}`)).toMatchObject({ title: 'My painting', scanId });
  expect(mockReplace).not.toHaveBeenCalled();

  await complete(localId);
  expect(await screen.findByRole('button', { name: 'View result' })).toBeEnabled();
  expect(screen.getByText(/^(View artwork|Saved · View in collection)$/)).toBeOnTheScreen();
  expect(mockReplace).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'View result' }));
  expect(mockReplace).toHaveBeenCalledWith({ pathname: '/result/[scanId]', params: { scanId } });
});

it('explains a failed capture and retries it through the queue', async () => {
  await render(<LocalScanScreen localId="cap-failed" />);
  expect(await screen.findByText(FAILED_TITLE)).toBeOnTheScreen();
  expect(screen.getByText('The photo couldn’t be read. Try scanning the painting again.')).toBeOnTheScreen();
  expect(screen.queryByText(WAITING_TITLE)).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: RETRY_BUTTON }));
  expect(mockRetry).toHaveBeenCalledWith('cap-failed');
});

it.each([
  ['identified', 'cap-done', 'scan-9'],
  ['answered as unsupported', 'cap-old', 'scan-u'],
])('hands an %s capture over to its server card', async (_state, localId, scanId) => {
  await render(<LocalScanScreen localId={localId} />);
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith({ pathname: '/result/[scanId]', params: { scanId } }));
  expect(screen.queryByText(WAITING_TITLE)).toBeNull();
  expect(screen.queryByText(FAILED_TITLE)).toBeNull();
});

it('says when the capture is no longer on this phone', async () => {
  await render(<LocalScanScreen localId="cap-gone" />);
  expect(await screen.findByText(MISSING_TITLE)).toBeOnTheScreen();
  expect(mockReplace).not.toHaveBeenCalled();
});
