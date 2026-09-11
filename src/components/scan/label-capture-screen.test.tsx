import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { ConvexError } from 'convex/values';
import type { ReactNode } from 'react';
import { AppState } from 'react-native';

import type { Id } from '../../../convex/_generated/dataModel';
import type { LabelFlowDisplay } from '../../../convex/lib/validators';

import { LABEL_PROMPT, LabelCaptureScreen, QR_FOUND, QUEUED_MESSAGE } from './label-capture-screen';
import { CONSENT_TITLE } from './label/consent-sheet';
import { SHARE_BUTTON } from './label/label-actions';
import { STEP_LABELS } from './label/progress-steps';
import type { PendingScan } from '@/db/schema';
import { LabelFlowError, type LabelStage } from '@/lib/label/flow';
import { formStateFromFlow, setFieldValue, unlockField } from '@/lib/label/fields';

type CameraProps = { isActive: boolean; outputs: unknown[]; onStarted: () => void };
type StageCallback = (stage: LabelStage) => void;

let mockReachable: boolean | undefined = true;
let mockCameraProps: CameraProps;
let mockQr: { enabled: boolean; onCode: (url: string) => void };
const mockPhoto = jest.fn();
const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
const mockCaptureId = jest.fn();
const mockUseScan = jest.fn();
const mockFlush = jest.fn();
const mockRetryLabel = jest.fn();
const mockDiscardLabel = jest.fn();
const mockLoadDraft = jest.fn();
let mockCapture: PendingScan | undefined;
let mockScan: { labelFlow?: LabelFlowDisplay; outcome?: 'confident'; scanId?: Id<'scans'> } | undefined;
const mockSetLabelPhoto = jest.fn();
const mockSetQrUrl = jest.fn();
const mockPersistLabel = jest.fn();
const mockRun = jest.fn();
const mockContribute = jest.fn();
const mockSave = jest.fn();
const mockRemove = jest.fn();
const mockHaptic = jest.fn();
const mockPermission = jest.fn();
const mockPicker = jest.fn();

jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));
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
    BottomSheet: ({ isPresented, children }: { isPresented: boolean; children: ReactNode }) => isPresented ? <View accessibilityLabel="Consent sheet">{children}</View> : null,
  };
});
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, replace: mockReplace, back: mockBack }) }));
jest.mock('expo-router/react-navigation', () => ({ useIsFocused: () => true }));
jest.mock('expo-network', () => ({ useNetworkState: () => ({ isInternetReachable: mockReachable }) }));
jest.mock('expo-haptics', () => ({
  selectionAsync: () => mockHaptic('selection'),
  notificationAsync: (type: string) => mockHaptic(type),
  NotificationFeedbackType: { Success: 'success' },
}));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }));
jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: () => mockPermission(),
  launchImageLibraryAsync: (options: unknown) => mockPicker(options),
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 60, bottom: 34 }) }));
jest.mock('react-native-vision-camera', () => ({
  useCameraPermission: () => ({ hasPermission: true, canRequestPermission: false, requestPermission: jest.fn() }),
  usePhotoOutput: () => ({ capturePhotoToFile: mockPhoto }),
  Camera: (props: CameraProps): ReactNode => { mockCameraProps = props; return null; },
}));
jest.mock('@/lib/capture/use-qr-scanner', () => ({
  useQrScanner: (enabled: boolean, onCode: (url: string) => void) => {
    mockQr = { enabled, onCode };
    return enabled ? { kind: 'qr-output' } : undefined;
  },
}));
jest.mock('@/db/repos/pending-scans', () => ({
  MAX_LABEL_ATTEMPTS: 5,
  setLabelPhoto: (...args: unknown[]) => mockSetLabelPhoto(...args),
  setQrUrl: (...args: unknown[]) => mockSetQrUrl(...args),
}));
jest.mock('@/lib/label/use-label-capture', () => ({ useLabelCapture: (id: string) => { mockCaptureId(id); return mockCapture; } }));
jest.mock('@/lib/result/use-scan', () => ({ useScan: (id: string | undefined) => { mockUseScan(id); return mockScan; } }));
jest.mock('@/lib/queue/queue', () => ({
  flushQueue: () => mockFlush(), retryPendingLabel: (id: string) => mockRetryLabel(id), discardPendingLabel: (id: string) => mockDiscardLabel(id),
}));
jest.mock('@/lib/label/draft', () => ({ loadLabelDraft: (id: string) => mockLoadDraft(id) }));
jest.mock('@/lib/files/photos', () => ({ persistLabelPhoto: (input: unknown) => mockPersistLabel(input) }));
jest.mock('@/lib/label/label-deps', () => ({ runLabelFlowForScan: (...args: unknown[]) => mockRun(...args) }));
jest.mock('@/lib/label/contribute', () => ({
  contributeLabel: (input: unknown) => mockContribute(input),
  contributionErrorMessage: (error: Error) => `mapped: ${error.message}`,
}));
jest.mock('@/lib/label/crop', () => ({ removeFile: (uri: string) => mockRemove(uri) }));
jest.mock('@/lib/result/save', () => ({ saveResult: (input: unknown) => mockSave(input) }));

const scanId = 'scan-1' as Id<'scans'>;
const capture = {
  localId: 'cap-1', photoPath: 'photos/c1.jpg', cropPath: 'crops/c1.jpg', vector: [0.1], descriptors: new ArrayBuffer(4), keypoints: new ArrayBuffer(4),
  modelVersion: 'm', attemptModelVersion: 'm', venueId: 'museum-1' as Id<'museums'>, visitId: null, visitLocalId: null, capturedAt: 1,
  labelPhotoPath: null, qrUrl: null, status: 'identified', attempts: 0, lastError: null, scanId, createdAt: 1,
} satisfies PendingScan;
const verified: LabelFlowDisplay = {
  stage: 'verified', evidence: ['tavily+image', 'wikidata'], warnings: ['date_outside_lifespan'], moderation: 'clear', updatedAt: 1,
  sourceUrl: 'https://museum.example/objects/1',
  fields: {
    title: { value: 'Water Lilies', evidence: 'tavily+image', locked: true },
    artist: { value: 'Claude Monet', evidence: 'wikidata', locked: true },
    date: { value: '1916', evidence: 'ocr', locked: false },
  },
};

function deferFlow() {
  let finish!: (flow: LabelFlowDisplay) => void;
  let fail!: (error: unknown) => void;
  mockRun.mockImplementation((_id: unknown, source: { qrUrl?: string }, onStage: StageCallback) => new Promise<LabelFlowDisplay>((resolve, reject) => {
    onStage(source.qrUrl ? 'qr' : 'read');
    finish = resolve;
    fail = reject;
  }));
  return { finish: (flow: LabelFlowDisplay) => act(async () => finish(flow)), fail: (error: unknown) => act(async () => fail(error)) };
}

async function start(props: Partial<Parameters<typeof LabelCaptureScreen>[0]> = {}) {
  const view = await render(<LabelCaptureScreen scanId={scanId} {...props} />);
  await act(async () => mockCameraProps?.onStarted());
  return view;
}

beforeEach(() => {
  jest.resetAllMocks();
  mockReachable = true;
  AppState.currentState = 'active';
  jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() } as never);
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  mockCapture = capture;
  mockScan = {};
  mockFlush.mockResolvedValue(undefined);
  mockRetryLabel.mockResolvedValue(undefined);
  mockLoadDraft.mockResolvedValue(undefined);
  mockDiscardLabel.mockImplementation(async () => { mockCapture = capture; });
  mockPhoto.mockResolvedValue({ filePath: '/tmp/label.jpg' });
  mockPersistLabel.mockResolvedValue('labels/cap-1.jpg');
  mockRun.mockResolvedValue(verified);
  mockContribute.mockResolvedValue({ contributionId: 'contrib-1', status: 'private' });
  mockSave.mockResolvedValue({ localId: 'saved-1', synced: Promise.resolve() });
  mockHaptic.mockResolvedValue(undefined);
  mockPermission.mockResolvedValue({ granted: true });
  mockPicker.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///picked/label.jpg' }] });
});
afterEach(() => jest.restoreAllMocks());

it('prompts for the label over the camera with the QR scanner running', async () => {
  await start();
  expect(screen.getByText(LABEL_PROMPT)).toBeOnTheScreen();
  expect(screen.getByText('Fill the frame with the label, flat and in focus')).toBeOnTheScreen();
  expect(mockCameraProps.isActive).toBe(true);
  expect(mockCameraProps.outputs).toContainEqual({ kind: 'qr-output' });
  expect(mockQr.enabled).toBe(true);
  expect(screen.getByRole('button', { name: 'Take photo' })).toBeEnabled();
  expect(mockCaptureId).toHaveBeenCalledWith(scanId);
});

it('reads a shot online, shows the stages, then locks the verified fields with their sources', async () => {
  const flow = deferFlow();
  await start();
  await fireEvent.press(screen.getByRole('button', { name: 'Take photo' }));
  expect(mockPhoto).toHaveBeenCalledWith({}, {});
  expect(mockRun).toHaveBeenCalledWith(scanId, { labelPhotoUri: 'file:///tmp/label.jpg', qrUrl: undefined }, expect.any(Function));
  expect(screen.getByText('Reading the label')).toBeOnTheScreen();
  expect(screen.getByLabelText(STEP_LABELS.read).props.accessibilityState).toMatchObject({ busy: true });
  await flow.finish(verified);
  expect(screen.getByText('From the label')).toBeOnTheScreen();
  expect(screen.getByLabelText('Title').props.defaultValue).toBe('Water Lilies');
  expect(screen.getByLabelText('Title').props.editable).toBe(false);
  expect(screen.getByLabelText('Date').props.editable).toBe(true);
  expect(screen.getByText('From the museum’s site')).toBeOnTheScreen();
  expect(screen.getByText('Wikidata')).toBeOnTheScreen();
  expect(screen.getByText('The date is outside the artist’s lifespan — please check')).toBeOnTheScreen();
  expect(screen.getByRole('link', { name: 'Museum page' })).toBeOnTheScreen();
  expect(mockRemove).toHaveBeenCalledWith('file:///tmp/label.jpg');
  expect(mockHaptic).toHaveBeenCalledWith('success');
});

it('shares only after consent: Share uploads and contributes, Not now sends nothing', async () => {
  await start();
  await fireEvent.press(screen.getByRole('button', { name: 'Take photo' }));
  await fireEvent.press(await screen.findByRole('button', { name: SHARE_BUTTON }));
  expect(screen.getByText(CONSENT_TITLE)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Not now' }));
  expect(mockContribute).not.toHaveBeenCalled();
  expect(screen.queryByText(CONSENT_TITLE)).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: SHARE_BUTTON }));
  await fireEvent.press(screen.getByRole('button', { name: 'Share' }));
  expect(mockContribute).toHaveBeenCalledWith({
    scanId, capture,
    state: expect.objectContaining({ title: expect.objectContaining({ value: 'Water Lilies', locked: true }) }),
  });
  expect(await screen.findByText('Thanks — shared privately until it’s verified')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: SHARE_BUTTON })).toBeNull();
  expect(screen.getByLabelText('Date').props.editable).toBe(false);
});

it('surfaces a sharing failure and lets the user try again', async () => {
  mockContribute.mockRejectedValue(new Error('boom'));
  await start();
  await fireEvent.press(screen.getByRole('button', { name: 'Take photo' }));
  await fireEvent.press(await screen.findByRole('button', { name: SHARE_BUTTON }));
  await fireEvent.press(screen.getByRole('button', { name: 'Share' }));
  expect(await screen.findByText('mapped: boom')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: SHARE_BUTTON })).toBeEnabled();
});

it('saves the label result without a suggestion, then links to the collection', async () => {
  await start();
  await fireEvent.press(screen.getByRole('button', { name: 'Take photo' }));
  await fireEvent.press(await screen.findByRole('button', { name: 'Save to collection' }));
  expect(mockSave).toHaveBeenCalledWith({
    scanId, capture, view: { kind: 'unidentified', runnerUps: [], editable: true },
    draft: { title: 'Water Lilies', artist: 'Claude Monet', date: '1916', medium: '', institution: '' },
  });
  await fireEvent.press(await screen.findByRole('link', { name: 'Saved · View in collection' }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/(tabs)/(collection)/[savedId]', params: { savedId: 'saved-1' } });
});

it('reads an imported label photo and ignores a cancelled picker', async () => {
  await start();
  mockPicker.mockResolvedValueOnce({ canceled: true, assets: [] });
  await fireEvent.press(screen.getByRole('button', { name: 'Import' }));
  expect(mockRun).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Take photo' })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Import' }));
  expect(mockPicker).toHaveBeenLastCalledWith({ mediaTypes: ['images'], quality: 1 });
  expect(mockRun).toHaveBeenCalledWith(scanId, { labelPhotoUri: 'file:///picked/label.jpg', qrUrl: undefined }, expect.any(Function));
  expect(await screen.findByLabelText('Title')).toBeOnTheScreen();
  expect(mockPhoto).not.toHaveBeenCalled();
});

it('runs the flow from a scanned QR code at once', async () => {
  const flow = deferFlow();
  await start();
  await act(async () => mockQr.onCode('https://museum.example/qr/1'));
  expect(mockRun).toHaveBeenCalledWith(scanId, { labelPhotoUri: undefined, qrUrl: 'https://museum.example/qr/1' }, expect.any(Function));
  expect(screen.getByText(QR_FOUND)).toBeOnTheScreen();
  expect(screen.getByLabelText(STEP_LABELS.qr).props.accessibilityState).toMatchObject({ busy: true });
  expect(mockPhoto).not.toHaveBeenCalled();
  await flow.finish(verified);
  expect(screen.getByLabelText('Artist').props.defaultValue).toBe('Claude Monet');
  expect(mockRemove).not.toHaveBeenCalled();
});

it('keeps the label photo with the scan while offline and returns to the card', async () => {
  mockReachable = false;
  await start();
  expect(screen.getByText('No signal — we’ll keep the label with your scan and finish when you’re back online')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Take photo' }));
  expect(await screen.findByText(QUEUED_MESSAGE)).toBeOnTheScreen();
  expect(mockPersistLabel).toHaveBeenCalledWith({ localId: 'cap-1', photoUri: 'file:///tmp/label.jpg' });
  expect(mockSetLabelPhoto).toHaveBeenCalledWith('cap-1', 'labels/cap-1.jpg');
  expect(mockRun).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Back to the scan' }));
  expect(mockBack).toHaveBeenCalledTimes(1);
});

it('stores a QR code on a queued capture even with signal, since identify has not run yet', async () => {
  mockCapture = { ...capture, scanId: null, status: 'queued' };
  await start({ scanId: 'local-cap-1' });
  expect(mockCaptureId).toHaveBeenCalledWith('local-cap-1');
  expect(mockUseScan).toHaveBeenCalledWith(undefined);
  await act(async () => mockQr.onCode('https://museum.example/qr/1'));
  expect(await screen.findByText(QUEUED_MESSAGE)).toBeOnTheScreen();
  expect(mockSetQrUrl).toHaveBeenCalledWith('cap-1', 'https://museum.example/qr/1');
  expect(mockRun).not.toHaveBeenCalled();
});

it.each(['read', 'verify'] as const)('queues the photo when signal is lost during %s and opens the completed label on reconnect', async (stage) => {
  const flow = deferFlow();
  const view = await start();
  await fireEvent.press(screen.getByRole('button', { name: 'Take photo' }));
  await act(async () => mockRun.mock.calls[0][2](stage));
  mockReachable = false;
  await view.rerender(<LabelCaptureScreen scanId={scanId} />);
  await flow.fail(new LabelFlowError('network', { cause: new Error('Network request failed') }));

  expect(screen.getByText(QUEUED_MESSAGE)).toBeOnTheScreen();
  expect(mockPersistLabel).toHaveBeenCalledWith({ localId: 'cap-1', photoUri: 'file:///tmp/label.jpg' });
  expect(mockSetLabelPhoto).toHaveBeenCalledWith('cap-1', 'labels/cap-1.jpg');
  expect(mockRemove).not.toHaveBeenCalled();
  expect(mockFlush).toHaveBeenCalledTimes(1);

  mockReachable = true;
  mockScan = { labelFlow: verified };
  await view.rerender(<LabelCaptureScreen scanId={scanId} />);
  expect(await screen.findByLabelText('Title')).toHaveProp('defaultValue', 'Water Lilies');
  expect(mockPhoto).toHaveBeenCalledTimes(1);
});

it('queues a QR source when its request is rate limited', async () => {
  const flow = deferFlow();
  await start();
  const url = 'https://museum.example/qr/1';
  await act(async () => mockQr.onCode(url));
  await flow.fail(new LabelFlowError('rate_limited', { cause: new ConvexError({ code: 'rate_limited', retryAfter: 60_000 }) }));
  expect(screen.getByText(QUEUED_MESSAGE)).toBeOnTheScreen();
  expect(mockSetQrUrl).toHaveBeenCalledWith('cap-1', url);
  expect(mockPersistLabel).not.toHaveBeenCalled();
  expect(mockRemove).not.toHaveBeenCalled();
  expect(mockFlush).toHaveBeenCalledTimes(1);
});

it('retains an interrupted label even after navigating away', async () => {
  const flow = deferFlow();
  const view = await start();
  await fireEvent.press(screen.getByRole('button', { name: 'Take photo' }));
  await view.unmount();
  await flow.fail(new LabelFlowError('network', { cause: new Error('Connection lost while action was in flight') }));
  expect(mockSetLabelPhoto).toHaveBeenCalledWith('cap-1', 'labels/cap-1.jpg');
  expect(mockRemove).not.toHaveBeenCalled();
  expect(mockFlush).toHaveBeenCalledTimes(1);
});

it('explains a paused reader and offers a retake', async () => {
  const flow = deferFlow();
  await start();
  await fireEvent.press(screen.getByRole('button', { name: 'Take photo' }));
  await flow.fail(new LabelFlowError('feature_off'));
  expect(screen.getByText('Label reading is paused right now')).toBeOnTheScreen();
  expect(mockRemove).toHaveBeenCalledWith('file:///tmp/label.jpg');
  await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
  expect(screen.getByRole('button', { name: 'Take photo' })).toBeOnTheScreen();
});

it('opens a persisted verified label without taking or reading another photo', async () => {
  mockScan = { labelFlow: verified };
  await start();
  expect(await screen.findByLabelText('Title')).toHaveProp('defaultValue', 'Water Lilies');
  expect(mockRun).not.toHaveBeenCalled();
  expect(mockPhoto).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Save to collection' })).toBeEnabled();
  expect(screen.getByRole('button', { name: SHARE_BUTTON })).toBeEnabled();
});

it('opens the form when a queued local scan finishes and preserves edits across subscription updates', async () => {
  mockCapture = { ...capture, scanId: null, status: 'queued', labelPhotoPath: 'labels/queued.jpg' };
  const view = await start({ scanId: 'local-cap-1' });
  expect(screen.getByText(QUEUED_MESSAGE)).toBeOnTheScreen();
  mockCapture = capture;
  mockScan = { labelFlow: verified };
  await view.rerender(<LabelCaptureScreen scanId="local-cap-1" />);
  expect(await screen.findByLabelText('Title')).toHaveProp('defaultValue', 'Water Lilies');
  expect(mockUseScan).toHaveBeenLastCalledWith(scanId);
  await fireEvent.changeText(screen.getByLabelText('Date'), '1917');
  mockScan = { labelFlow: { ...verified, updatedAt: 2 } };
  await view.rerender(<LabelCaptureScreen scanId="local-cap-1" />);
  await fireEvent.press(screen.getByRole('button', { name: 'Save to collection' }));
  expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({ scanId, draft: expect.objectContaining({ date: '1917' }) }));
  expect(mockRun).not.toHaveBeenCalled();
});

it('offers a retry when the queued label exhausted its attempts', async () => {
  mockCapture = { ...capture, labelPhotoPath: 'labels/failed.jpg', lastError: 'model_error', attempts: 5 };
  await start();
  await fireEvent.press(await screen.findByRole('button', { name: 'Try again' }));
  expect(mockRetryLabel).toHaveBeenCalledWith('cap-1');
});

it('opens the match when queued identification succeeds without needing the label', async () => {
  mockCapture = { ...capture, scanId: null, status: 'queued', labelPhotoPath: 'labels/queued.jpg' };
  const view = await start({ scanId: 'local-cap-1' });
  mockCapture = capture;
  mockScan = { scanId, outcome: 'confident' };
  await view.rerender(<LabelCaptureScreen scanId="local-cap-1" />);
  await fireEvent.press(screen.getByRole('button', { name: 'View result' }));
  expect(mockReplace).toHaveBeenCalledWith({ pathname: '/result/[scanId]', params: { scanId } });
});

it('lets a failed queued QR be replaced with a label photo', async () => {
  mockCapture = { ...capture, qrUrl: 'https://unrelated.example/', attempts: 5, lastError: 'qr_host_not_allowed' };
  await start();
  await fireEvent.press(screen.getByRole('button', { name: 'Retake label' }));
  expect(mockDiscardLabel).toHaveBeenCalledWith('cap-1');
  await fireEvent.press(screen.getByRole('button', { name: 'Import' }));
  expect(mockRun).toHaveBeenCalledWith(scanId, { labelPhotoUri: 'file:///picked/label.jpg', qrUrl: undefined }, expect.any(Function));
  expect(await screen.findByLabelText('Title')).toBeOnTheScreen();
});

it('shows a recoverable failure when a queued verification was moderated', async () => {
  mockCapture = { ...capture, qrUrl: 'https://museum.example/work' };
  const view = await start();
  mockCapture = capture;
  mockScan = { labelFlow: { ...verified, moderation: 'flagged', fields: {}, evidence: [], warnings: [] } };
  await view.rerender(<LabelCaptureScreen scanId={scanId} />);
  expect(screen.queryByText(QUEUED_MESSAGE)).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Retake label' }));
  expect(screen.getByRole('button', { name: 'Import' })).toBeOnTheScreen();
});

it('locks the shutter and ignores QR callbacks while a native photo is being taken', async () => {
  let finish!: (result: { filePath: string }) => void;
  mockPhoto.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  await start();
  await fireEvent.press(screen.getByRole('button', { name: 'Take photo' }));
  expect(screen.getByRole('button', { name: 'Take photo' })).toBeDisabled();
  expect(mockQr.enabled).toBe(false);
  await fireEvent.press(screen.getByRole('button', { name: 'Take photo' }));
  await act(async () => mockQr.onCode('https://museum.example/work'));
  expect(mockPhoto).toHaveBeenCalledTimes(1);
  expect(mockRun).not.toHaveBeenCalled();
  await act(async () => finish({ filePath: '/tmp/label.jpg' }));
  expect(mockRun).toHaveBeenCalledTimes(1);
  expect(await screen.findByLabelText('Title')).toBeOnTheScreen();
});

it('locks input until the picker is dismissed and releases it after cancellation or failure', async () => {
  let dismiss!: (result: { canceled: boolean; assets: never[] }) => void;
  mockPicker.mockImplementationOnce(() => new Promise((resolve) => { dismiss = resolve; }));
  await start();
  await fireEvent.press(screen.getByRole('button', { name: 'Import' }));
  expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
  await act(async () => mockQr.onCode('https://museum.example/work'));
  expect(mockRun).not.toHaveBeenCalled();
  await act(async () => dismiss({ canceled: true, assets: [] }));
  expect(screen.getByRole('button', { name: 'Import' })).toBeEnabled();
  mockPicker.mockRejectedValueOnce(new Error('Picker unavailable'));
  await fireEvent.press(screen.getByRole('button', { name: 'Import' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
  expect(screen.getByRole('button', { name: 'Import' })).toBeEnabled();
});

it('can add the missing artist and share after saving a title-only label', async () => {
  mockScan = { labelFlow: { ...verified, fields: { title: verified.fields.title } } };
  await start();
  await fireEvent.press(await screen.findByRole('button', { name: 'Save to collection' }));
  expect(screen.getByLabelText('Artist')).toHaveProp('editable', true);
  await fireEvent.changeText(screen.getByLabelText('Artist'), 'Claude Monet');
  await fireEvent.press(screen.getByRole('button', { name: SHARE_BUTTON }));
  await fireEvent.press(screen.getByRole('button', { name: 'Share' }));
  expect(mockContribute).toHaveBeenCalledWith(expect.objectContaining({
    state: expect.objectContaining({ artist: expect.objectContaining({ value: 'Claude Monet' }) }),
  }));
  expect(mockSave).toHaveBeenCalledTimes(1);
  expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({ draft: expect.objectContaining({ artist: '' }) }));
});

it('restores the original values and unlocks from a persisted sharing draft', async () => {
  mockScan = { labelFlow: { ...verified, fields: { ...verified.fields, date: { ...verified.fields.date!, value: '1917' } } } };
  const draft = setFieldValue(unlockField(formStateFromFlow(verified), 'title'), 'date', '1917');
  mockLoadDraft.mockResolvedValue(draft);
  await start();
  expect(await screen.findAllByText('Edited by you')).toHaveLength(2);
  expect(screen.getByLabelText('Title')).toHaveProp('editable', true);
  await fireEvent.press(screen.getByRole('button', { name: SHARE_BUTTON }));
  await fireEvent.press(screen.getByRole('button', { name: 'Share' }));
  expect(mockContribute).toHaveBeenCalledWith(expect.objectContaining({ state: draft }));
});

it('waits for persisted edits and offers a retry if they cannot be loaded', async () => {
  mockScan = { labelFlow: verified };
  mockLoadDraft.mockRejectedValueOnce(new Error('Database unavailable'));
  await start();
  expect(await screen.findByText('Couldn’t load your label edits. Try again.')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: SHARE_BUTTON })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByRole('button', { name: SHARE_BUTTON })).toBeEnabled();
});
