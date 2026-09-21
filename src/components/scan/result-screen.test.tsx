import { db } from '@/db/client';
import { notes, savedWorks } from '@/db/schema';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ConvexProvider, ConvexReactClient } from 'convex/react';
import { getFunctionName } from 'convex/server';
import * as SQLite from 'expo-sqlite';
import type { ReactNode } from 'react';
import { Alert, AppState } from 'react-native';

import type { Id } from '../../../convex/_generated/dataModel';

import { ResultScreen } from './result-screen';
import { LABEL_BUTTON } from './result/save-bar';
import {
  bridge, confidentScan, confidentScanWithoutProse, failedScan, haystacks, lilies, missScan, SCAN_ID, softScan, unsupportedScan,
} from './result/__fixtures__/scan';
import { enqueuePendingScan, pendingScansQuery } from '@/db/repos/pending-scans';
import { getSavedWork } from '@/db/repos/saved-works';
import * as visits from '@/db/repos/visits';
import { resolveWithLabel } from '@/lib/result/feedback';
import { runMuseumSearchForScan } from '@/lib/museum-search/museum-search-deps';
import { candidates, confirmed, verified } from '@/lib/museum-search/__fixtures__/search';
import { setMuseumSearchConsent } from '@/lib/settings/museum-search';
import { contributeLabel } from '@/lib/label/contribute';
import { clearLabelDraft, saveLabelDraft } from '@/lib/label/draft';
import * as labelDrafts from '@/lib/label/draft';
import { formStateFromFlow, unlockField } from '@/lib/label/fields';
jest.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: () => true }));
jest.mock('./capture-context-button', () => ({ CaptureContextButton: () => null }));
jest.mock('../collection/gallery-button');
jest.mock('./capture-photos-button', () => ({ CapturePhotosButton: () => null, useCapturePhotos: () => ({ label: 'Add photos', open: jest.fn(), unavailable: false }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 34, left: 0, right: 0 }) }));

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockDismissAll = jest.fn();
const mockSign = jest.fn();
const mockSaveMutation = jest.fn();
const mockHaptic = jest.fn();
const mockAuth = { isAuthenticated: true };
let mockUuid = 0;
let mockFocused = true;
const mockNetwork = { isInternetReachable: true };
let client: ConvexReactClient;
const results = new Map<string, unknown>();
const listeners = new Set<() => void>();
const databaseListeners = new Set<Parameters<typeof SQLite.addDatabaseChangeListener>[0]>();

jest.mock('@/db/client', () => ({ db: jest.requireActual('../../db/test-db').createTestDatabase() }));
jest.mock('@/lib/files/photos', () => ({ ...jest.requireActual('@/lib/files/photos'), captureFileUri: (path: string) => `file:///documents/${path}` }));
jest.mock('@/lib/venue/venue-db', () => ({ venueNameById: async () => 'Legion of Honor' }));
jest.mock('@/lib/attested-write', () => ({ signPayload: (payload: unknown) => mockSign(payload) }));
jest.mock('@/lib/queue/queue', () => ({ retryPendingScan: jest.fn() }));
jest.mock('@/lib/museum-search/museum-search-deps', () => ({ runMuseumSearchForScan: jest.fn() }));
jest.mock('@/lib/label/contribute', () => ({ contributeLabel: jest.fn(), contributionErrorMessage: () => 'Couldn’t save to the shared index right now' }));
jest.mock('expo-network', () => ({ useNetworkState: () => mockNetwork }));
jest.mock('@/lib/convex-client', () => ({
  convex: { mutation: (fn: unknown, args: unknown) => mockSaveMutation(jest.requireActual('convex/server').getFunctionName(fn), args) },
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => `saved-${++mockUuid}` }));
jest.mock('expo-router/react-navigation', () => ({ useIsFocused: () => mockFocused }));
jest.mock('expo-router', () => {
  const { Pressable, Text, View } = jest.requireActual('react-native');
  const Action = ({ children, onPress, disabled }: { children: ReactNode; onPress: () => void; disabled?: boolean }) => <Pressable accessibilityRole="button" disabled={disabled} accessibilityState={{ disabled: !!disabled }} onPress={onPress}><Text>{children}</Text></Pressable>;
  return { useRouter: () => ({ push: mockPush, navigate: mockPush, replace: mockReplace, dismissAll: mockDismissAll }),
    Stack: { Toolbar: Object.assign(View, { Menu: View, MenuAction: Action }) } };
});
jest.mock('expo-haptics', () => ({
  notificationAsync: (type: string) => mockHaptic(type),
  NotificationFeedbackType: { Success: 'success' },
}));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }));
jest.mock('convex/react', () => ({
  ...jest.requireActual('convex/react'),
  useConvexAuth: () => mockAuth,
}));
jest.mock('@expo/ui', () => {
  const { Pressable, Text, TextInput, View } = jest.requireActual('react-native');
  return {
    Host: View, RNHostView: View,
    Button: ({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) => (
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress}><Text>{label}</Text></Pressable>
    ),
    TextInput: ({ defaultValue, placeholder, editable, onChangeText }: { defaultValue?: string; placeholder?: string; editable?: boolean; onChangeText?: (value: string) => void }) => (
      <TextInput accessibilityLabel={placeholder} placeholder={placeholder} defaultValue={defaultValue} editable={editable} onChangeText={onChangeText} />
    ),
    BottomSheet: ({ isPresented, children }: { isPresented: boolean; children: ReactNode }) => isPresented ? <View accessibilityLabel="Not right sheet">{children}</View> : null,
  };
});

beforeAll(async () => {
  await visits.upsertVisit({ visitedOn: '1970-01-01', timeZone: 'UTC', localId: 'aea0b816-f46f-5312-a657-f92d1af2cb76', venueId: 'museum-met' as Id<'museums'>, venueName: 'The Met', startedAt: 1 });
  await enqueuePendingScan({
    localId: 'capture-1', photoPath: 'photos/c1.jpg', cropPath: 'crops/c1.jpg', vector: [0.1], descriptors: new ArrayBuffer(0), keypoints: new ArrayBuffer(0),
    modelVersion: 'm', attemptModelVersion: 'm', venueId: 'museum-met' as Id<'museums'>, visitLocalId: 'aea0b816-f46f-5312-a657-f92d1af2cb76', capturedAt: 1,
    status: 'identified', scanId: SCAN_ID, createdAt: 1,
  });
  await enqueuePendingScan({
    localId: 'capture-9', photoPath: 'photos/c9.jpg', cropPath: 'crops/c9.jpg', vector: [0.1], descriptors: new ArrayBuffer(0), keypoints: new ArrayBuffer(0),
    modelVersion: 'm', attemptModelVersion: 'm', capturedAt: 2, status: 'queued', createdAt: 2,
  });
});

beforeEach(async () => {
  db.delete(notes).run(); db.delete(savedWorks).run();
  mockFocused = true;
  jest.resetAllMocks();
  mockNetwork.isInternetReachable = true;
  await setMuseumSearchConsent('unset');
  await clearLabelDraft(SCAN_ID);
  jest.mocked(runMuseumSearchForScan).mockResolvedValue({ stage: 'none', reason: 'no_candidates' });
  AppState.currentState = 'active';
  jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove() {} }));
  databaseListeners.clear();
  jest.spyOn(SQLite, 'addDatabaseChangeListener').mockImplementation((listener) => {
    databaseListeners.add(listener);
    return { remove: () => { databaseListeners.delete(listener); } };
  });
  mockAuth.isAuthenticated = true;
  mockSign.mockResolvedValue({ nonce: 'nonce-1', assertionBase64: '', payloadJson: 'p' });
  mockSaveMutation.mockResolvedValue({ collectionId: 'col-1', updatedAt: 20, updatedBy: 'device' });
  mockHaptic.mockResolvedValue(undefined);
  results.clear();
  listeners.clear();
  results.set('devices:me', { deviceId: 'device-1', attested: false, trustWeight: 1 });
  results.set('scans:get', confidentScan);
  client = new ConvexReactClient('https://test.convex.cloud', { logger: false });
  jest.spyOn(client, 'watchQuery').mockImplementation((...[query]: Parameters<ConvexReactClient['watchQuery']>) => ({
    localQueryResult: () => {
      const result = results.get(getFunctionName(query));
      if (result instanceof Error) throw result;
      return result;
    },
    onUpdate: (callback) => {
      listeners.add(callback);
      return () => { listeners.delete(callback); };
    },
    localQueryLogs: () => undefined,
    journal: () => undefined,
  }));
  jest.spyOn(client, 'mutation').mockImplementation(async (...[fn]: Parameters<ConvexReactClient['mutation']>) => {
    if (getFunctionName(fn) === 'feedback:rejectMatch') return { feedbackId: 'fb-1' };
    return null;
  });
});
afterEach(async () => {
  await client.close();
  jest.restoreAllMocks();
});

function publish(scan: unknown) {
  return act(() => {
    results.set('scans:get', scan);
    for (const listener of listeners) listener();
  });
}

async function openDetails() {
  const edit = screen.queryByRole('button', { name: 'Edit details' });
  if (edit) await fireEvent.press(edit);
}

function result(scanId: string = SCAN_ID) {
  return <ConvexProvider client={client}><ResultScreen scanId={scanId} /></ConvexProvider>;
}

async function identifiedCapture(localId: string) {
  await enqueuePendingScan({
    localId, photoPath: `photos/${localId}.jpg`, cropPath: `crops/${localId}.jpg`, vector: [0.1],
    descriptors: new ArrayBuffer(0), keypoints: new ArrayBuffer(0), modelVersion: 'm', attemptModelVersion: 'm',
    capturedAt: 1, createdAt: 1, status: 'identified', scanId: localId as Id<'scans'>,
  });
}

async function inRecentScans(localId: string) {
  return (await pendingScansQuery()).some((row) => row.localId === localId);
}

it('keeps a viewed result in recent scans until it is saved', async () => {
  const localId = 'viewed-result';
  await identifiedCapture(localId);
  await render(result(localId));
  expect(await screen.findByText('Match')).toBeOnTheScreen();
  expect(await inRecentScans(localId)).toBe(true);
  await fireEvent.press(screen.getByRole('button', { name: /^Save (to collection|with these details|photo for later)$/ }));
  await screen.findByText(/^(View artwork|Saved · View in collection)$/);
  expect(await inRecentScans(localId)).toBe(false);
});

it.each([
  ['unsupported', unsupportedScan], ['failed', failedScan], ['unavailable', null],
] as const)('keeps a scan in the queue when its server card is %s', async (kind, scan) => {
  const localId = `recent-${kind}`;
  await identifiedCapture(localId);
  results.set('scans:get', scan);
  await render(result(localId));
  await waitFor(() => expect(screen.getByLabelText('Your photo of this painting').props.source).toEqual([{ uri: `file:///documents/crops/${localId}.preview.jpg` }]));
  expect(await inRecentScans(localId)).toBe(true);
});

it('shows a confident match with its fields, chip, prose, sources and news', async () => {
  await render(result());
  expect(await screen.findByText('Match')).toBeOnTheScreen();
  expect(screen.getByText('Water Lilies')).toBeOnTheScreen();
  expect(screen.queryByLabelText('Title')).toBeNull();
  await openDetails();
  expect(screen.getByLabelText('Title').props.defaultValue).toBe('Water Lilies');
  expect(screen.getByLabelText('Artist').props.defaultValue).toBe('Claude Monet');
  expect(screen.getByLabelText('Date').props.defaultValue).toBe('1916');
  expect(screen.getByLabelText('Medium').props.defaultValue).toBe('Oil on canvas');
  expect(screen.getByLabelText('Institution').props.defaultValue).toBe('Metropolitan Museum of Art');
  expect(screen.getByText('About this work')).toBeOnTheScreen();
  expect(screen.getByText('Monet painted this pond at Giverny in 1916.')).toBeOnTheScreen();
  expect(screen.getByRole('link', { name: 'The Met' })).toBeOnTheScreen();
  expect(screen.getByText('From the web')).toBeOnTheScreen();
  expect(screen.getByRole('link', { name: 'Example News' })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: LABEL_BUTTON })).toBeOnTheScreen();
  expect(screen.queryByText('Other possibilities')).toBeNull();
  expect(screen.getByRole('button', { name: 'Not right?' })).toBeOnTheScreen();
  await waitFor(() => expect(screen.getByLabelText('Your photo of this painting').props.source).toEqual([{ uri: 'file:///documents/crops/c1.preview.jpg' }]));
  expect(client.watchQuery).toHaveBeenCalledWith(expect.anything(), { scanId: SCAN_ID }, {});
});

it('keeps the card usable while the prose is still being written, then fills it in', async () => {
  results.set('scans:get', confidentScanWithoutProse);
  await render(result());
  expect(await screen.findByLabelText('Writing about this work…')).toBeOnTheScreen();
  await openDetails();
  await fireEvent.changeText(screen.getByLabelText('Title'), 'Nymphéas');
  await publish({ ...confidentScanWithoutProse, docent: confidentScan.docent, factSheet: confidentScan.factSheet });
  expect(await screen.findByText('Monet painted this pond at Giverny in 1916.')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: /^Save (to collection|with these details|photo for later)$/ }));
  await screen.findByText(/^(View artwork|Saved · View in collection)$/);
  expect(await getSavedWork(`saved-${mockUuid}`)).toMatchObject({ title: 'Nymphéas' });
});

it('shows a soft match as a maybe with the suggestions and the label button', async () => {
  results.set('scans:get', softScan);
  await render(result());
  expect(await screen.findByText('Maybe')).toBeOnTheScreen();
  expect(screen.getByText('12% confidence')).toBeOnTheScreen();
  await openDetails();
  expect(screen.getByLabelText('Title').props.defaultValue).toBe('The Japanese Footbridge');
  expect(screen.getByText('Other possibilities')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: /^Haystacks, Claude Monet/ })).toBeOnTheScreen();
  expect(screen.queryByText('About this work')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: LABEL_BUTTON }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/label/[scanId]', params: { scanId: SCAN_ID, intent: 'review' } });
});

it('keeps optional details hidden on an unidentified card and offers every candidate', async () => {
  results.set('scans:get', missScan);
  await render(result());
  expect(await screen.findByText('Unidentified')).toBeOnTheScreen();
  expect(screen.getByText('20% confidence')).toBeOnTheScreen();
  expect(screen.getByText('31% confidence')).toBeOnTheScreen();
  expect(screen.queryByLabelText('Title')).toBeNull();
  await openDetails();
  expect(screen.getByLabelText('Title').props.defaultValue).toBe('');
  expect(screen.getByLabelText('Artist').props.defaultValue).toBe('');
  expect(screen.getByRole('button', { name: /^Haystacks, Claude Monet/ })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: /^The Japanese Footbridge, Claude Monet/ })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: /^Save (to collection|with these details|photo for later)$/ })).toBeEnabled();
  expect(screen.getByText(LABEL_BUTTON)).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Not right?' })).toBeNull();
  await fireEvent.changeText(screen.getByLabelText('Title'), 'Pond at dusk');
  expect(screen.getByRole('button', { name: /^Save (to collection|with these details|photo for later)$/ })).toBeEnabled();
});

it.each([softScan, missScan, failedScan])('saves a $outcome scan as a photo without adopting an unconfirmed identity', async (scan) => {
  results.set('scans:get', scan);
  await render(result());
  const save = await screen.findByRole('button', { name: 'Save photo for later' });
  expect(screen.queryByLabelText('Title')).toBeNull();
  await fireEvent.press(save);
  expect(await screen.findByText('Saved to collection')).toBeOnTheScreen();
  expect(await getSavedWork(`saved-${mockUuid}`)).toMatchObject({ title: 'Unidentified artwork', artist: '', objectId: null, photoPath: 'photos/c1.jpg' });
  expect(mockSaveMutation).toHaveBeenCalledWith('collections:saveToCollection', expect.objectContaining({ suggested: null, objectId: undefined }));
});

it('saves a runner-up picked on a soft card with its object instead of a bare photo', async () => {
  results.set('scans:get', softScan);
  await render(result());
  await fireEvent.press(await screen.findByRole('button', { name: /^Haystacks, Claude Monet/ }));
  expect(screen.queryByRole('button', { name: 'Save photo for later' })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Save with these details' }));
  await screen.findByText(/^(View artwork|Saved · View in collection)$/);
  expect(await getSavedWork(`saved-${mockUuid}`)).toMatchObject({ title: 'Haystacks', artist: 'Claude Monet', objectId: haystacks.objectId });
  expect(mockSaveMutation).toHaveBeenCalledWith('collections:saveToCollection', expect.objectContaining({ objectId: haystacks.objectId, suggested: null }));
});

it('fills the fields from a suggestion picked on a soft card without sending feedback', async () => {
  results.set('scans:get', softScan);
  await render(result());
  await fireEvent.press(await screen.findByRole('button', { name: /^Haystacks, Claude Monet/ }));
  await openDetails();
  expect(screen.getByLabelText('Title').props.defaultValue).toBe('Haystacks');
  expect(screen.getByText('Maybe')).toBeOnTheScreen();
  expect(screen.queryByText('12% confidence')).toBeNull();
  expect(screen.getByText('62% confidence')).toBeOnTheScreen();
  expect(client.mutation).not.toHaveBeenCalled();
});

it('saves an untouched confident card locally, tells the server the suggestion was kept, and links to the collection', async () => {
  await render(result());
  await fireEvent.press(await screen.findByRole('button', { name: /^Save (to collection|with these details|photo for later)$/ }));
  const link = await screen.findByText(/^(View artwork|Saved · View in collection)$/);
  const savedId = `saved-${mockUuid}`;
  expect(mockHaptic).toHaveBeenCalledWith('success');
  expect(await getSavedWork(savedId)).toMatchObject({
    title: 'Water Lilies', artist: 'Claude Monet', scanId: SCAN_ID, objectId: lilies.objectId, cropPath: 'crops/c1.preview.jpg', venueName: 'The Met',
  });
  await waitFor(() => expect(mockSaveMutation).toHaveBeenCalledWith('collections:saveToCollection', expect.objectContaining({
    localId: savedId, scanId: SCAN_ID, objectId: lilies.objectId, visitLocalId: 'aea0b816-f46f-5312-a657-f92d1af2cb76',
    snapshot: expect.objectContaining({ title: 'Water Lilies', artist: 'Claude Monet' }),
    suggested: { title: 'Water Lilies', artist: 'Claude Monet' },
  })));
  expect(screen.queryByLabelText('Title')).toBeNull();
  expect(screen.getByText('1 artwork · 1 new photo')).toBeOnTheScreen();
  await fireEvent.press(link);
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/saved/[savedId]', params: { savedId } });
});

it.each([softScan, missScan])('removes match choices after saving a $outcome card', async (scan) => {
  results.set('scans:get', scan);
  await render(result());
  await openDetails();
  await fireEvent.changeText(await screen.findByLabelText('Title'), 'My painting');
  expect(screen.getByRole('button', { name: /^Haystacks, Claude Monet/ })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: /^Save (to collection|with these details|photo for later)$/ }));
  const link = await screen.findByText(/^(View artwork|Saved · View in collection)$/);
  const savedId = `saved-${mockUuid}`;
  expect(screen.queryByText('Other possibilities')).toBeNull();
  expect(screen.queryByRole('button', { name: /^Haystacks, Claude Monet/ })).toBeNull();
  expect(screen.getByText(`Saved as ${(await getSavedWork(savedId))?.title}.`)).toBeOnTheScreen();
  await fireEvent.press(link);
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/saved/[savedId]', params: { savedId } });
});

it.each([confidentScan, softScan])('locks the draft and match choices while saving a $outcome card', async (scan) => {
  results.set('scans:get', scan);
  const visit = await visits.getVisit('aea0b816-f46f-5312-a657-f92d1af2cb76');
  let finishVisit!: (value: typeof visit) => void;
  jest.spyOn(visits, 'getVisit').mockReturnValueOnce(new Promise((resolve) => { finishVisit = resolve; }));
  await render(result());
  await openDetails();
  const saveButton = await screen.findByRole('button', { name: /^Save (to collection|with these details|photo for later)$/ });
  const savePromise = fireEvent.press(saveButton);
  await screen.findByRole('button', { name: /^Save (to collection|with these details|photo for later)$/, busy: true });
  await fireEvent.changeText(screen.getByLabelText('Title'), 'Edited while saving');
  try {
    expect(screen.getByLabelText('Title').props.editable).toBe(false);
    expect(screen.getByRole('button', { name: /^Save (to collection|with these details|photo for later)$/, busy: true })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Not right?' })).toBeNull();
    expect(screen.queryByText('Other possibilities')).toBeNull();
    if (scan.outcome === 'soft') {
      expect(screen.getByRole('button', { name: LABEL_BUTTON })).toBeDisabled();
    }
  } finally {
    await act(async () => {
      finishVisit(visit);
      await savePromise;
    });
  }
  await screen.findByText(/^(View artwork|Saved · View in collection)$/);
  const savedTitle = scan.outcome === 'confident' ? scan.best?.title : 'Unidentified artwork';
  expect(screen.getByText(`Saved as ${savedTitle}.`)).toBeOnTheScreen();
  expect((await getSavedWork(`saved-${mockUuid}`))?.title).toBe(savedTitle);
  expect(mockSaveMutation).toHaveBeenCalledWith('collections:saveToCollection', expect.objectContaining({
    snapshot: expect.objectContaining({ title: savedTitle }),
  }));
});

it('unlocks the draft and match choices after a local save fails so the user can correct and retry', async () => {
  results.set('scans:get', softScan);
  jest.spyOn(visits, 'getVisit').mockRejectedValueOnce(new Error('Local read failed'));
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  await render(result());
  await fireEvent.press(await screen.findByRole('button', { name: /^Save (to collection|with these details|photo for later)$/ }));
  expect(await screen.findByText('Couldn’t save. Try again.')).toBeOnTheScreen();
  await openDetails();
  expect(screen.getByLabelText('Title').props.editable).toBe(true);
  expect(screen.getByRole('button', { name: 'Not right?' })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: LABEL_BUTTON })).toBeEnabled();
  await fireEvent.press(screen.getByRole('button', { name: /^Haystacks, Claude Monet/ }));
  await openDetails();
  await fireEvent.changeText(screen.getByLabelText('Title'), 'My haystacks');
  await fireEvent.press(screen.getByRole('button', { name: /^Save (to collection|with these details|photo for later)$/ }));
  await screen.findByText(/^(View artwork|Saved · View in collection)$/);
  expect(await getSavedWork(`saved-${mockUuid}`)).toMatchObject({ title: 'My haystacks', objectId: haystacks.objectId });
});

it('records a rejection when "Not right?" opens, resolves it with the picked runner-up and re-renders as a maybe', async () => {
  await render(result());
  await fireEvent.press(await screen.findByRole('button', { name: 'Not right?' }));
  const sheet = await screen.findByLabelText('Not right sheet');
  expect(sheet).toBeOnTheScreen();
  expect(screen.getByText('Maybe one of these?')).toBeOnTheScreen();
  await waitFor(() => expect(client.mutation).toHaveBeenCalledTimes(1));
  expect(mockSign).toHaveBeenCalledWith(JSON.stringify({ objectId: lilies.objectId, operation: 'rejectMatch', scanId: SCAN_ID }));
  expect(jest.mocked(client.mutation).mock.calls[0][1]).toEqual({ scanId: SCAN_ID, objectId: lilies.objectId, nonce: 'nonce-1', assertionBase64: '' });

  await fireEvent.press(screen.getByRole('button', { name: /^The Japanese Footbridge, Claude Monet/ }));
  await waitFor(() => expect(client.mutation).toHaveBeenCalledTimes(2));
  expect(getFunctionName(jest.mocked(client.mutation).mock.calls[1][0])).toBe('feedback:resolveRejection');
  expect(jest.mocked(client.mutation).mock.calls[1][1]).toEqual({ feedbackId: 'fb-1', resolution: { kind: 'runner_up', objectId: bridge.objectId } });
  expect(screen.queryByLabelText('Not right sheet')).toBeNull();
  expect(screen.getByText('Maybe')).toBeOnTheScreen();
  await openDetails();
  expect(screen.getByLabelText('Title').props.defaultValue).toBe('The Japanese Footbridge');
  expect(screen.queryByText('About this work')).toBeNull();
  expect(screen.getByRole('button', { name: /^Haystacks, Claude Monet/ })).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Water Lilies, Claude Monet' })).toBeNull();
  expect(screen.getByText(LABEL_BUTTON)).toBeOnTheScreen();
});

it('routes to the label from the sheet and keeps the choices when feedback cannot be sent', async () => {
  mockSign.mockResolvedValue(null);
  await render(result());
  await fireEvent.press(await screen.findByRole('button', { name: 'Not right?' }));
  expect(await screen.findByText('This device can’t send feedback yet.')).toBeOnTheScreen();
  expect(client.mutation).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: /^Haystacks, Claude Monet/ })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'None of these — point at the label' }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/label/[scanId]', params: { scanId: SCAN_ID, intent: 'review' } });
  expect(screen.queryByLabelText('Not right sheet')).toBeNull();
});

it('hands a recorded rejection to the label screen so a verified label can resolve it', async () => {
  await publish(softScan);
  await render(result());
  await fireEvent.press(await screen.findByRole('button', { name: 'Not right?' }));
  await fireEvent.press(screen.getByRole('button', { name: 'None of these — point at the label' }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/label/[scanId]', params: { scanId: SCAN_ID, intent: 'review' } });
  resolveWithLabel(client, SCAN_ID, 'contrib-1' as Id<'contributions'>);
  await waitFor(() => expect(client.mutation).toHaveBeenCalledWith(expect.anything(), {
    feedbackId: 'fb-1', resolution: { kind: 'label', contributionId: 'contrib-1' },
  }));
});

it('opens the label while the rejection challenge waits for network', async () => {
  mockSign.mockImplementation(() => new Promise(() => {}));
  await render(result());
  await fireEvent.press(await screen.findByRole('button', { name: 'Not right?' }));
  await fireEvent.press(screen.getByRole('button', { name: 'None of these — point at the label' }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/label/[scanId]', params: { scanId: SCAN_ID, intent: 'review' } });
});

it('waits for the device before querying and shows the unsupported, failed and queued states', async () => {
  mockAuth.isAuthenticated = false;
  const view = await render(result());
  expect(await screen.findByLabelText('Identifying…')).toBeOnTheScreen();
  expect(client.watchQuery).not.toHaveBeenCalled();
  mockAuth.isAuthenticated = true;
  results.set('scans:get', unsupportedScan);
  await view.rerender(result());
  expect(await screen.findByText('Update the app to identify this painting')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Update the app' })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: /^Save (to collection|photo for later)$/ })).toBeEnabled();
  expect(screen.queryByText(LABEL_BUTTON)).toBeNull();
  await publish(failedScan);
  expect(await screen.findByText('Couldn’t identify this painting')).toBeOnTheScreen();
  expect(screen.getByText('The photo couldn’t be read. Try scanning the painting again.')).toBeOnTheScreen();
  expect(screen.queryByText('bad_features')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  await view.rerender(result('local-capture-9'));
  expect(await screen.findByText('Waiting for signal')).toBeOnTheScreen();
  await waitFor(() => expect(screen.getByLabelText('Your photo of this painting').props.source).toEqual([{ uri: 'file:///documents/crops/c9.preview.jpg' }]));
});

it('saves an unsupported scan anyway with a typed title and keeps its scan id', async () => {
  results.set('scans:get', unsupportedScan);
  await render(result());
  await fireEvent.press(await screen.findByRole('button', { name: 'Add details (optional)' }));
  await fireEvent.changeText(await screen.findByLabelText('Title'), 'Blue room');
  await fireEvent.press(screen.getByRole('button', { name: /^Save (to collection|photo for later)$/ }));
  await screen.findByText(/^(View artwork|Saved · View in collection)$/);
  expect(await getSavedWork(`saved-${mockUuid}`)).toMatchObject({ title: 'Blue room', scanId: SCAN_ID, objectId: null, cropPath: 'crops/c1.preview.jpg' });
  await waitFor(() => expect(mockSaveMutation).toHaveBeenCalledWith('collections:saveToCollection', expect.objectContaining({ scanId: SCAN_ID, suggested: null })));
});

it('starts a fresh card when the same screen receives another scan id', async () => {
  const view = await render(result());
  await fireEvent.press(await screen.findByRole('button', { name: /^Save (to collection|with these details|photo for later)$/ }));
  await screen.findByText(/^(View artwork|Saved · View in collection)$/);
  results.set('scans:get', softScan);
  await view.rerender(result('scan-2'));
  expect(await screen.findByText('Maybe')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: /^Save (to collection|with these details|photo for later)$/ })).toBeOnTheScreen();
  expect(screen.queryByText(/^(View artwork|Saved · View in collection)$/)).toBeNull();
  expect(screen.getByRole('button', { name: 'Not right?' })).toBeOnTheScreen();
  await openDetails();
  expect(screen.getByLabelText('Title').props.editable).toBe(true);
});

it('shows a failed card when the server refuses the scan', async () => {
  results.set('scans:get', null);
  await render(result());
  expect(await screen.findByText('Couldn’t identify this painting')).toBeOnTheScreen();
  expect(screen.queryByText(haystacks.title)).toBeNull();
});

it('explains an invalid scan link without exposing server details and offers a way out', async () => {
  results.set('scans:get', new Error('[CONVEX Q(scans:get)] [Request ID: secret] ArgumentValidationError: Invalid scanId\nCalled by client'));
  await render(result('invalid-scan'));
  expect(await screen.findByText('This scan link is invalid or no longer available.')).toBeOnTheScreen();
  expect(screen.queryByText(/Request ID|Called by client/)).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Scan another artwork' }));
  expect(mockDismissAll).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenCalledWith('/(tabs)/(scan)/scan');
  expect(mockReplace).not.toHaveBeenCalled();
});

it('searches soft or missed cards only with a venue and granted consent, never prompting for consent on the card', async () => {
  results.set('scans:get', softScan);
  const view = await render(result());
  await screen.findByText('Maybe');
  expect(screen.queryByText("Search this museum's collection?")).toBeNull();
  await act(async () => { await setMuseumSearchConsent('declined'); });
  await view.rerender(result());
  await publish({ ...missScan, venueId: undefined });
  await act(async () => { await setMuseumSearchConsent('granted'); });
  await view.rerender(result());
  expect(runMuseumSearchForScan).not.toHaveBeenCalled();
  await publish(missScan);
  await waitFor(() => expect(runMuseumSearchForScan).toHaveBeenCalledTimes(1));
  expect(screen.getByRole('button', { name: LABEL_BUTTON })).toBeEnabled();
});

it('automatically searches once while consented and online, leaving the label available during progress', async () => {
  await setMuseumSearchConsent('granted');
  results.set('scans:get', softScan);
  let finish!: (value: Awaited<ReturnType<typeof runMuseumSearchForScan>>) => void;
  jest.mocked(runMuseumSearchForScan).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const view = await render(result());
  expect(await screen.findByLabelText("Searching the museum’s collection…")).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: LABEL_BUTTON })).toBeEnabled();
  await act(async () => { finish({ stage: 'none', reason: 'no_match' }); });
  mockFocused = false;
  await view.rerender(result());
  mockFocused = true;
  await view.rerender(result());
  expect(runMuseumSearchForScan).toHaveBeenCalledTimes(1);
});

it('waits for connectivity before automatically searching', async () => {
  await setMuseumSearchConsent('granted');
  mockNetwork.isInternetReachable = false;
  results.set('scans:get', missScan);
  const view = await render(result());
  await screen.findByRole('button', { name: LABEL_BUTTON });
  expect(screen.queryByLabelText("Searching the museum’s collection…")).toBeNull();
  expect(runMuseumSearchForScan).not.toHaveBeenCalled();
  mockNetwork.isInternetReachable = true;
  await view.rerender(result());
  await waitFor(() => expect(runMuseumSearchForScan).toHaveBeenCalledTimes(1));
});

it('resumes stored candidates on remount and restores confirmed fields from the subscription', async () => {
  await setMuseumSearchConsent('granted');
  results.set('scans:get', { ...missScan, museumSearch: candidates });
  jest.mocked(runMuseumSearchForScan).mockResolvedValue({ stage: 'done', flow: verified, confirmedAt: verified.updatedAt });
  const view = await render(result());
  expect(await screen.findByText("Found on the museum's site")).toBeOnTheScreen();
  expect(runMuseumSearchForScan).toHaveBeenCalledWith(expect.objectContaining({ stored: candidates }));
  expect(screen.getByLabelText('Title').props.defaultValue).toBe('Blue painting');
  expect(screen.getByLabelText('Title').props.editable).toBe(false);
  expect(screen.getAllByText('From the museum’s site')).toHaveLength(2);
  expect(screen.getByRole('link', { name: 'Museum page' })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: LABEL_BUTTON })).toBeEnabled();
  await view.unmount();
  results.set('scans:get', { ...missScan, museumSearch: confirmed, labelFlow: verified });
  jest.mocked(runMuseumSearchForScan).mockClear();
  await render(result());
  expect(await screen.findByText("Found on the museum's site")).toBeOnTheScreen();
  expect(screen.getByLabelText('Title').props.defaultValue).toBe('Blue painting');
  await fireEvent.press(screen.getByRole('link', { name: 'Museum page' }));
  expect(jest.requireMock('expo-web-browser').openBrowserAsync).toHaveBeenCalledWith(verified.sourceUrl);
  expect(runMuseumSearchForScan).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: /^Save (to collection|with these details|photo for later)$/ }));
  await screen.findByText(/^(View artwork|Saved · View in collection)$/);
  expect(await getSavedWork(`saved-${mockUuid}`)).toMatchObject({ title: 'Blue painting', artist: 'A. Painter', objectId: null });
  expect(screen.getByRole('button', { name: LABEL_BUTTON })).toBeEnabled();
});

it.each([
  ['cap', 'Museum search is paused for today'], ['no_candidates', "Not on the museum's site — point at the label"],
] as const)('restores stored %s without starting a flow', async (reason, message) => {
  await setMuseumSearchConsent('granted');
  results.set('scans:get', { ...missScan, museumSearch: { stage: 'none', reason, updatedAt: 1 } });
  await render(result());
  expect(await screen.findByText(message)).toBeOnTheScreen();
  expect(runMuseumSearchForScan).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: LABEL_BUTTON })).toBeEnabled();
});

it('starts automatic search after consent is granted in Settings', async () => {
  results.set('scans:get', missScan);
  const view = await render(result());
  await screen.findByRole('button', { name: LABEL_BUTTON });
  expect(runMuseumSearchForScan).not.toHaveBeenCalled();
  mockFocused = false;
  await view.rerender(result());
  await setMuseumSearchConsent('granted');
  mockFocused = true;
  await view.rerender(result());
  await waitFor(() => expect(runMuseumSearchForScan).toHaveBeenCalledTimes(1));
  expect(screen.getByRole('button', { name: LABEL_BUTTON })).toBeEnabled();
});

it.each(['no_venue_site', 'venue_opted_out'])('hides museum search when the backend reports %s', async (reason) => {
  await setMuseumSearchConsent('granted');
  results.set('scans:get', missScan);
  jest.mocked(runMuseumSearchForScan).mockResolvedValue({ stage: 'none', reason });
  await render(result());
  await waitFor(() => expect(runMuseumSearchForScan).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.queryByLabelText("Searching the museum’s collection…")).toBeNull());
  expect(screen.getByRole('button', { name: LABEL_BUTTON })).toBeEnabled();
});

it('keeps a stored confirmation available offline after search revocation and shares automatically on save', async () => {
  await setMuseumSearchConsent('declined');
  mockNetwork.isInternetReachable = false;
  results.set('scans:get', { ...missScan, museumSearch: confirmed, labelFlow: verified });
  jest.mocked(contributeLabel).mockResolvedValue({ contributionId: 'contribution-1' as Id<'contributions'>, status: 'tentative' });
  await render(result());
  expect(await screen.findByText("Found on the museum's site")).toBeOnTheScreen();
  expect(runMuseumSearchForScan).not.toHaveBeenCalled();
  expect(contributeLabel).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Save to collection' }));
  await waitFor(() => expect(contributeLabel).toHaveBeenCalledWith(expect.objectContaining({
    scanId: SCAN_ID, museumSearchUpdatedAt: confirmed.updatedAt, state: expect.objectContaining({ title: expect.objectContaining({ value: 'Blue painting', locked: true, evidence: 'tavily+image' }) }),
  })));
  expect(await screen.findByText('Saved to the shared index as a tentative match for other visitors at this museum.')).toBeOnTheScreen();
});

it('keeps the label available when a stored museum confirmation failed moderation', async () => {
  await setMuseumSearchConsent('granted');
  results.set('scans:get', { ...missScan, museumSearch: confirmed, labelFlow: { ...verified, moderation: 'flagged', fields: {} } });
  await render(result());
  expect(await screen.findByText("Couldn't search right now")).toBeOnTheScreen();
  expect(screen.queryByText("Found on the museum's site")).toBeNull();
  expect(screen.getByRole('button', { name: LABEL_BUTTON })).toBeEnabled();
  expect(runMuseumSearchForScan).not.toHaveBeenCalled();
});

it.each(['saving', 'saved', 'failed'] as const)('keeps the original card when museum search confirms while its save is %s', async (stage) => {
  await setMuseumSearchConsent('granted');
  results.set('scans:get', softScan);
  let finishSearch!: (value: Awaited<ReturnType<typeof runMuseumSearchForScan>>) => void;
  jest.mocked(runMuseumSearchForScan).mockReturnValue(new Promise((resolve) => { finishSearch = resolve; }));
  const visit = await visits.getVisit('aea0b816-f46f-5312-a657-f92d1af2cb76');
  let finishSave!: () => void;
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(visits, 'getVisit').mockImplementationOnce(() => new Promise((resolve, reject) => {
    finishSave = () => stage === 'failed' ? reject(new Error('Local read failed')) : resolve(visit);
  }));
  await render(result());
  await screen.findByLabelText("Searching the museum’s collection…");
  await openDetails();
  await fireEvent.press(screen.getByRole('button', { name: /^Save (to collection|with these details|photo for later)$/ }));
  await screen.findByRole('button', { name: /^Save (to collection|with these details|photo for later)$/, busy: true });
  if (stage !== 'saving') await act(async () => { finishSave(); });
  await act(async () => { finishSearch({ stage: 'done', flow: verified, confirmedAt: verified.updatedAt }); });
  await publish({ ...softScan, museumSearch: confirmed, labelFlow: verified });
  if (stage === 'saved') expect(screen.getByText('Saved as Unidentified artwork.')).toBeOnTheScreen();
  else expect(screen.getByLabelText('Title').props.defaultValue).toBe('The Japanese Footbridge');
  expect(screen.queryByText("Found on the museum's site")).toBeNull();
  if (stage === 'failed') {
    expect(screen.getByText('Couldn’t save. Try again.')).toBeOnTheScreen();
    expect(screen.getByLabelText('Title').props.editable).toBe(true);
    expect(screen.getByRole('button', { name: /^Save (to collection|with these details|photo for later)$/ })).toBeEnabled();
    return;
  }
  if (stage === 'saving') {
    expect(screen.getByRole('button', { name: /^Save (to collection|with these details|photo for later)$/, busy: true })).toBeDisabled();
    await act(async () => { finishSave(); });
  }
  const link = await screen.findByText(/^(View artwork|Saved · View in collection)$/);
  expect(screen.queryByRole('button', { name: /^Save (to collection|with these details|photo for later)$/ })).toBeNull();
  await fireEvent.press(link);
  expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/saved/[savedId]', params: { savedId: `saved-${mockUuid}` } });
  expect(mockSaveMutation).toHaveBeenCalledTimes(1);
});

it.each(['date', 'title'] as const)('keeps sharing progress and edited %s through server verification and a retry', async (field) => {
  results.set('scans:get', { ...missScan, museumSearch: confirmed, labelFlow: verified });
  let fail!: (error: Error) => void;
  jest.mocked(contributeLabel).mockReturnValueOnce(new Promise((_resolve, reject) => { fail = reject; }));
  jest.mocked(contributeLabel).mockResolvedValue({ contributionId: 'contribution-1' as Id<'contributions'>, status: 'tentative' });
  jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => { buttons?.find((button) => button.text === 'Edit')?.onPress?.(); });
  await render(result());
  await screen.findByText("Found on the museum's site");
  const label = field === 'title' ? 'Title' : 'Date';
  const value = field === 'title' ? 'My blue painting' : '1900';
  if (field === 'title') await fireEvent.press(screen.getByRole('button', { name: 'Edit Title' }));
  await fireEvent.changeText(screen.getByLabelText(label), value);
  await fireEvent.press(screen.getByRole('button', { name: screen.queryByRole('button', { name: 'Retry saving to the shared index' }) ? 'Retry saving to the shared index' : 'Save to collection' }));
  await screen.findByLabelText('Saving to the shared index…');
  const submitted = jest.mocked(contributeLabel).mock.calls[0][0].state;
  await saveLabelDraft(SCAN_ID, submitted, confirmed.updatedAt);
  await publish({ ...missScan, museumSearch: confirmed, labelFlow: {
    ...verified, updatedAt: 3, sourceUrl: field === 'title' ? undefined : verified.sourceUrl,
    fields: { ...verified.fields, [field]: { value, evidence: 'ocr', locked: false } },
  } });
  expect(screen.getByLabelText('Saving to the shared index…')).toBeOnTheScreen();
  expect(screen.getByLabelText(label).props.defaultValue).toBe(value);
  expect(screen.queryByRole('button', { name: 'Retry saving to the shared index' })).toBeNull();
  expect(contributeLabel).toHaveBeenCalledTimes(1);
  await act(async () => { fail(new Error('Upload failed')); });
  expect(await screen.findByText('Couldn’t save to the shared index right now. Your artwork is saved to your collection.')).toBeOnTheScreen();
  expect(screen.getByText('Edited by you')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: screen.queryByRole('button', { name: 'Retry saving to the shared index' }) ? 'Retry saving to the shared index' : 'Save to collection' }));
  expect(await screen.findByText('Saved to the shared index as a tentative match for other visitors at this museum.')).toBeOnTheScreen();
  expect(jest.mocked(contributeLabel).mock.calls[1][0].state).toEqual(submitted);
});

it('keeps museum search unavailable after picking a runner-up on a confident scan', async () => {
  await setMuseumSearchConsent('granted');
  await render(result());
  await fireEvent.press(await screen.findByRole('button', { name: 'Not right?' }));
  await fireEvent.press(screen.getByRole('button', { name: /^The Japanese Footbridge, Claude Monet/ }));
  await screen.findByText('Maybe');
  expect(screen.queryByLabelText("Searching the museum’s collection…")).toBeNull();
  expect(runMuseumSearchForScan).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: LABEL_BUTTON })).toBeEnabled();
});


it.each(['Title', 'Institution'])('keeps edited %s when a background museum search confirms', async (label) => {
  await setMuseumSearchConsent('granted');
  results.set('scans:get', softScan);
  let finish!: (value: Awaited<ReturnType<typeof runMuseumSearchForScan>>) => void;
  jest.mocked(runMuseumSearchForScan).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  await render(result());
  await screen.findByLabelText("Searching the museum’s collection…");
  await openDetails();
  await fireEvent.changeText(screen.getByLabelText(label), 'My own entry');
  await act(async () => { finish({ stage: 'done', flow: verified, confirmedAt: verified.updatedAt }); });
  await publish({ ...softScan, museumSearch: confirmed, labelFlow: verified });
  expect(screen.getByLabelText(label).props.defaultValue).toBe('My own entry');
  expect(screen.queryByText("Found on the museum's site")).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: /^Save (to collection|with these details|photo for later)$/ }));
  await screen.findByText(/^(View artwork|Saved · View in collection)$/);
  expect(await getSavedWork(`saved-${mockUuid}`)).toMatchObject({ [label.toLowerCase()]: 'My own entry' });
});

it.each(['title', 'date', 'unlock'] as const)('restores the sharing draft after a failed share and reopen (%s)', async (edit) => {
  results.set('scans:get', { ...missScan, museumSearch: confirmed, labelFlow: verified });
  let fail!: (error: Error) => void;
  jest.mocked(contributeLabel).mockReturnValueOnce(new Promise((_resolve, reject) => { fail = reject; }));
  jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => { buttons?.find((button) => button.text === 'Edit')?.onPress?.(); });
  const view = await render(result());
  await screen.findByLabelText('Title');
  if (edit !== 'date') await fireEvent.press(screen.getByRole('button', { name: 'Edit Title' }));
  if (edit !== 'unlock') await fireEvent.changeText(screen.getByLabelText(edit === 'title' ? 'Title' : 'Date'), edit === 'title' ? 'My own title' : '1900');
  await fireEvent.press(screen.getByRole('button', { name: screen.queryByRole('button', { name: 'Retry saving to the shared index' }) ? 'Retry saving to the shared index' : 'Save to collection' }));
  await screen.findByLabelText('Saving to the shared index…');
  const submitted = jest.mocked(contributeLabel).mock.calls[0][0].state;
  await saveLabelDraft(SCAN_ID, submitted, confirmed.updatedAt);
  if (edit !== 'unlock') await publish({ ...missScan, museumSearch: confirmed, labelFlow: {
    ...verified, sourceUrl: edit === 'title' ? undefined : verified.sourceUrl, updatedAt: 3,
    fields: { ...verified.fields, [edit]: { value: submitted[edit].value, evidence: 'ocr', locked: false } },
  } });
  await act(async () => { fail(new Error('Upload failed')); });
  await screen.findByText('Couldn’t save to the shared index right now. Your artwork is saved to your collection.');
  await view.unmount();
  await render(result());
  expect(await screen.findByText('Edited by you')).toBeOnTheScreen();
  expect(screen.getByLabelText('Title').props.defaultValue).toBe(submitted.title.value);
  expect(screen.getByLabelText('Date').props.defaultValue).toBe(submitted.date.value);
  jest.mocked(contributeLabel).mockResolvedValue({ contributionId: 'contribution-1' as Id<'contributions'>, status: 'tentative' });
  await fireEvent.press(screen.getByRole('button', { name: screen.queryByRole('button', { name: 'Retry saving to the shared index' }) ? 'Retry saving to the shared index' : 'Save to collection' }));
  await screen.findByText('Saved to the shared index as a tentative match for other visitors at this museum.');
  expect(jest.mocked(contributeLabel).mock.calls[1][0].state).toEqual(submitted);
});

it('opens fresh label capture from a confirmed museum result', async () => {
  results.set('scans:get', { ...missScan, museumSearch: confirmed, labelFlow: verified });
  await render(result());
  await fireEvent.press(await screen.findByRole('button', { name: LABEL_BUTTON }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/label/[scanId]', params: { scanId: SCAN_ID, intent: 'capture' } });
});


it.each([true, false])('keeps edits protected until draft storage recovers (same source: %s)', async (sameSource) => {
  await setMuseumSearchConsent('declined');
  mockNetwork.isInternetReachable = false;
  results.set('scans:get', { ...missScan, museumSearch: confirmed, labelFlow: { ...verified, sourceUrl: sameSource ? verified.sourceUrl : undefined } });
  await saveLabelDraft(SCAN_ID, unlockField(formStateFromFlow(verified), 'title'), confirmed.updatedAt);
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(labelDrafts, 'loadLabelDraft').mockRejectedValueOnce(new Error('Disk read failed'));
  await render(result());
  const retry = await screen.findByRole('button', { name: 'Try again' });
  expect(screen.queryByRole('button', { name: 'Add to the shared index' })).toBeNull();
  expect(screen.queryByLabelText('Title')).toBeNull();
  await fireEvent.press(retry);
  expect(await screen.findByText('Edited by you')).toBeOnTheScreen();
  expect(screen.getByLabelText('Title').props.editable).toBe(true);
  expect(runMuseumSearchForScan).not.toHaveBeenCalled();
});

it('keeps a chosen runner-up when the background museum search confirms', async () => {
  await setMuseumSearchConsent('granted');
  results.set('scans:get', softScan);
  let finish!: (value: Awaited<ReturnType<typeof runMuseumSearchForScan>>) => void;
  jest.mocked(runMuseumSearchForScan).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  await render(result());
  await screen.findByLabelText("Searching the museum’s collection…");
  await fireEvent.press(screen.getByRole('button', { name: /^Haystacks, Claude Monet/ }));
  await act(async () => { finish({ stage: 'done', flow: verified, confirmedAt: verified.updatedAt }); });
  await publish({ ...softScan, museumSearch: confirmed, labelFlow: verified });
  await openDetails();
  expect(screen.getByLabelText('Title').props.defaultValue).toBe('Haystacks');
});

it.each([undefined, verified.sourceUrl])('drops the museum result after a fresh label replaces it (source: %s)', async (sourceUrl) => {
  results.set('scans:get', { ...missScan, museumSearch: confirmed, labelFlow: verified });
  const view = await render(result());
  await screen.findByText("Found on the museum's site");
  await fireEvent.press(screen.getByRole('button', { name: LABEL_BUTTON }));
  mockFocused = false;
  await view.rerender(result());
  await publish({ ...missScan, museumSearch: confirmed, labelFlow: {
    ...verified, updatedAt: 10, sourceUrl,
    fields: { title: { value: 'Corrected from label', evidence: 'ocr', locked: false } },
  } });
  mockFocused = true;
  await view.rerender(result());
  await waitFor(() => expect(screen.queryByText("Found on the museum's site")).toBeNull());
  await fireEvent.press(screen.getByRole('button', { name: LABEL_BUTTON }));
  expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/label/[scanId]', params: { scanId: SCAN_ID, intent: 'review' } });
});

it('uses the confirmed museum fields instead of an earlier label sharing draft', async () => {
  const labelFlow = {
    ...verified, sourceUrl: undefined, updatedAt: 1,
    fields: {
      title: { value: 'Old OCR title', evidence: 'ocr' as const, locked: false },
      artist: { value: 'Old OCR artist', evidence: 'ocr' as const, locked: false },
    },
  };
  await saveLabelDraft(SCAN_ID, formStateFromFlow(labelFlow));
  await setMuseumSearchConsent('granted');
  results.set('scans:get', { ...missScan, labelFlow });
  jest.mocked(runMuseumSearchForScan).mockResolvedValue({ stage: 'done', flow: verified, confirmedAt: verified.updatedAt });
  await render(result());
  await screen.findByText("Found on the museum's site");
  expect(screen.getByLabelText('Title').props.defaultValue).toBe('Blue painting');
  expect(screen.getByLabelText('Title').props.editable).toBe(false);
  await fireEvent.press(screen.getByRole('button', { name: /^Save (to collection|with these details|photo for later)$/ }));
  await screen.findByText(/^(View artwork|Saved · View in collection)$/);
  expect(await getSavedWork(`saved-${mockUuid}`)).toMatchObject({ title: 'Blue painting', artist: 'A. Painter' });
});

it('reopens a completed label review from a scan without a museum result', async () => {
  results.set('scans:get', { ...missScan, labelFlow: verified });
  await render(result());
  await fireEvent.press(await screen.findByRole('button', { name: LABEL_BUTTON }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/label/[scanId]', params: { scanId: SCAN_ID, intent: 'review' } });
});

it('keeps a tentative visitor suggestion visible without starting museum search', async () => {
  await setMuseumSearchConsent('granted');
  results.set('scans:get', { ...softScan, best: { ...softScan.best!, identityStatus: 'tentative' },
    runnerUps: [{ ...haystacks, identityStatus: 'tentative' }] });
  jest.mocked(runMuseumSearchForScan).mockResolvedValue({ stage: 'none', reason: 'no_candidates' });
  await render(result());
  expect(await screen.findByText('Maybe')).toBeOnTheScreen();
  expect(screen.getAllByText('Shared by a visitor. Label not independently confirmed.')).toHaveLength(2);
  expect(runMuseumSearchForScan).not.toHaveBeenCalled();
  await openDetails();
  expect(screen.getByLabelText('Title').props.editable).toBe(true);
  expect(screen.getByRole('button', { name: 'Not right?' })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: /^Save (to collection|with these details|photo for later)$/ })).toBeEnabled();
  expect(screen.queryByText('About this work')).toBeNull();
});

it('saves edited tentative metadata without implying confirmation', async () => {
  results.set('scans:get', { ...softScan, best: { ...softScan.best!, identityStatus: 'tentative' } });
  await render(result());
  await openDetails();
  await fireEvent.changeText(await screen.findByLabelText('Title'), 'My reading of the label');
  await fireEvent.press(screen.getByRole('button', { name: /^Save (to collection|with these details|photo for later)$/ }));
  await screen.findByText(/^(View artwork|Saved · View in collection)$/);
  expect(await getSavedWork(`saved-${mockUuid}`)).toMatchObject({ title: 'My reading of the label' });
  expect(mockSaveMutation).toHaveBeenCalledWith('collections:saveToCollection', expect.objectContaining({ suggested: null }));
  expect(screen.getByText('Saved as My reading of the label.')).toBeOnTheScreen();
});
