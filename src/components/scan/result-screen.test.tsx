import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ConvexProvider, ConvexReactClient } from 'convex/react';
import { getFunctionName } from 'convex/server';
import type { ReactNode } from 'react';

import type { Id } from '../../../convex/_generated/dataModel';

import { ResultScreen } from './result-screen';
import { LABEL_BUTTON } from './result/save-bar';
import {
  bridge, confidentScan, confidentScanWithoutProse, failedScan, haystacks, lilies, missScan, SCAN_ID, softScan, unsupportedScan,
} from './result/__fixtures__/scan';
import { enqueuePendingScan } from '@/db/repos/pending-scans';
import { getSavedWork } from '@/db/repos/saved-works';
import * as visits from '@/db/repos/visits';
import { resolveWithLabel } from '@/lib/result/feedback';

const mockPush = jest.fn();
const mockSign = jest.fn();
const mockSaveMutation = jest.fn();
const mockHaptic = jest.fn();
const mockAuth = { isAuthenticated: true };
let mockUuid = 0;
let client: ConvexReactClient;
const results = new Map<string, unknown>();
const listeners = new Set<() => void>();

jest.mock('@/db/client', () => ({ db: jest.requireActual('../../db/test-db').createTestDatabase() }));
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));
jest.mock('@/lib/files/photos', () => ({ captureFileUri: (path: string) => `file:///documents/${path}` }));
jest.mock('@/lib/venue/venue-db', () => ({ venueNameById: async () => 'Legion of Honor' }));
jest.mock('@/lib/attested-write', () => ({ signPayload: (payload: unknown) => mockSign(payload) }));
jest.mock('@/lib/convex-client', () => ({
  convex: { mutation: (fn: unknown, args: unknown) => mockSaveMutation(jest.requireActual('convex/server').getFunctionName(fn), args) },
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => `saved-${++mockUuid}` }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
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
    Host: View,
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
  await visits.upsertVisit({ localId: 'visit-local-1', venueId: 'museum-met' as Id<'museums'>, venueName: 'The Met', startedAt: 1, remoteVisitId: 'visit-remote-1' as Id<'visits'> });
  await enqueuePendingScan({
    localId: 'capture-1', photoPath: 'photos/c1.jpg', cropPath: 'crops/c1.jpg', vector: [0.1], descriptors: new ArrayBuffer(0), keypoints: new ArrayBuffer(0),
    modelVersion: 'm', attemptModelVersion: 'm', venueId: 'museum-met' as Id<'museums'>, visitLocalId: 'visit-local-1', capturedAt: 1,
    status: 'identified', scanId: SCAN_ID, createdAt: 1,
  });
});

beforeEach(() => {
  jest.resetAllMocks();
  mockAuth.isAuthenticated = true;
  mockSign.mockResolvedValue({ nonce: 'nonce-1', assertionBase64: '', payloadJson: 'p' });
  mockSaveMutation.mockResolvedValue({ collectionId: 'col-1' });
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

function result(scanId: string = SCAN_ID) {
  return <ConvexProvider client={client}><ResultScreen scanId={scanId} /></ConvexProvider>;
}

it('shows a confident match with its fields, chip, prose, sources and news', async () => {
  await render(result());
  expect(await screen.findByText('Match')).toBeOnTheScreen();
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
  expect(screen.queryByText(LABEL_BUTTON)).toBeNull();
  expect(screen.queryByText('Maybe one of these?')).toBeNull();
  expect(screen.getByRole('button', { name: 'Not right?' })).toBeOnTheScreen();
  await waitFor(() => expect(screen.getByLabelText('Your photo of this painting').props.source).toEqual([{ uri: 'file:///documents/crops/c1.jpg' }]));
  expect(client.watchQuery).toHaveBeenCalledWith(expect.anything(), { scanId: SCAN_ID }, {});
});

it('keeps the card usable while the prose is still being written, then fills it in', async () => {
  results.set('scans:get', confidentScanWithoutProse);
  await render(result());
  expect(await screen.findByText('Writing about this work…')).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByLabelText('Title'), 'Nymphéas');
  await publish({ ...confidentScanWithoutProse, docent: confidentScan.docent, factSheet: confidentScan.factSheet });
  expect(await screen.findByText('Monet painted this pond at Giverny in 1916.')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Save to collection' }));
  await screen.findByRole('link', { name: 'Saved · View in collection' });
  expect(await getSavedWork(`saved-${mockUuid}`)).toMatchObject({ title: 'Nymphéas' });
});

it('shows a soft match as a maybe with the suggestions and the label button', async () => {
  results.set('scans:get', softScan);
  await render(result());
  expect(await screen.findByText('Maybe')).toBeOnTheScreen();
  expect(screen.getByLabelText('Title').props.defaultValue).toBe('The Japanese Footbridge');
  expect(screen.getByText('Maybe one of these?')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Haystacks, Claude Monet' })).toBeOnTheScreen();
  expect(screen.queryByText('About this work')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: LABEL_BUTTON }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/label/[scanId]', params: { scanId: SCAN_ID } });
});

it('leaves an unidentified card blank, offers every candidate and requires a title to save', async () => {
  results.set('scans:get', missScan);
  await render(result());
  expect(await screen.findByText('Unidentified')).toBeOnTheScreen();
  expect(screen.getByLabelText('Title').props.defaultValue).toBe('');
  expect(screen.getByLabelText('Artist').props.defaultValue).toBe('');
  expect(screen.getByRole('button', { name: 'Haystacks, Claude Monet' })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'The Japanese Footbridge, Claude Monet' })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Save to collection' })).toBeDisabled();
  expect(screen.getByText(LABEL_BUTTON)).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Not right?' })).toBeNull();
  await fireEvent.changeText(screen.getByLabelText('Title'), 'Pond at dusk');
  expect(screen.getByRole('button', { name: 'Save to collection' })).toBeEnabled();
});

it('fills the fields from a suggestion picked on a soft card without sending feedback', async () => {
  results.set('scans:get', softScan);
  await render(result());
  await fireEvent.press(await screen.findByRole('button', { name: 'Haystacks, Claude Monet' }));
  expect(screen.getByLabelText('Title').props.defaultValue).toBe('Haystacks');
  expect(screen.getByText('Maybe')).toBeOnTheScreen();
  expect(client.mutation).not.toHaveBeenCalled();
});

it('saves an untouched confident card locally, tells the server the suggestion was kept, and links to the collection', async () => {
  await render(result());
  await fireEvent.press(await screen.findByRole('button', { name: 'Save to collection' }));
  const link = await screen.findByRole('link', { name: 'Saved · View in collection' });
  const savedId = `saved-${mockUuid}`;
  expect(mockHaptic).toHaveBeenCalledWith('success');
  expect(await getSavedWork(savedId)).toMatchObject({
    title: 'Water Lilies', artist: 'Claude Monet', scanId: SCAN_ID, objectId: lilies.objectId, cropPath: 'crops/c1.jpg', venueName: 'The Met',
  });
  await waitFor(() => expect(mockSaveMutation).toHaveBeenCalledWith('collections:saveToCollection', expect.objectContaining({
    localId: savedId, scanId: SCAN_ID, objectId: lilies.objectId, visitId: 'visit-remote-1',
    snapshot: expect.objectContaining({ title: 'Water Lilies', artist: 'Claude Monet' }),
    suggested: { title: 'Water Lilies', artist: 'Claude Monet' },
  })));
  expect(screen.getByLabelText('Title').props.editable).toBe(false);
  await fireEvent.press(link);
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/(tabs)/(collection)/[savedId]', params: { savedId } });
});

it.each([softScan, missScan])('removes match choices after saving a $outcome card', async (scan) => {
  results.set('scans:get', scan);
  await render(result());
  await fireEvent.changeText(await screen.findByLabelText('Title'), 'My painting');
  expect(screen.getByRole('button', { name: 'Haystacks, Claude Monet' })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Save to collection' }));
  const link = await screen.findByRole('link', { name: 'Saved · View in collection' });
  const savedId = `saved-${mockUuid}`;
  expect(screen.queryByText('Maybe one of these?')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Haystacks, Claude Monet' })).toBeNull();
  expect(screen.getByLabelText('Title').props.defaultValue).toBe((await getSavedWork(savedId))?.title);
  await fireEvent.press(link);
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/(tabs)/(collection)/[savedId]', params: { savedId } });
});

it.each([confidentScan, softScan])('locks the draft and match choices while saving a $outcome card', async (scan) => {
  results.set('scans:get', scan);
  const visit = await visits.getVisit('visit-local-1');
  let finishVisit!: (value: typeof visit) => void;
  jest.spyOn(visits, 'getVisit').mockReturnValueOnce(new Promise((resolve) => { finishVisit = resolve; }));
  await render(result());
  const saveButton = await screen.findByRole('button', { name: 'Save to collection' });
  const savePromise = fireEvent.press(saveButton);
  await screen.findByText('Saving…');
  await fireEvent.changeText(screen.getByLabelText('Title'), 'Edited while saving');
  try {
    expect(screen.getByLabelText('Title').props.editable).toBe(false);
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Not right?' })).toBeNull();
    expect(screen.queryByText('Maybe one of these?')).toBeNull();
    if (scan.outcome === 'soft') {
      expect(screen.getByRole('button', { name: LABEL_BUTTON })).toBeDisabled();
    }
  } finally {
    await act(async () => {
      finishVisit(visit);
      await savePromise;
    });
  }
  await screen.findByRole('link', { name: 'Saved · View in collection' });
  expect(screen.getByLabelText('Title').props.defaultValue).toBe(scan.best?.title);
  expect((await getSavedWork(`saved-${mockUuid}`))?.title).toBe(scan.best?.title);
  expect(mockSaveMutation).toHaveBeenCalledWith('collections:saveToCollection', expect.objectContaining({
    snapshot: expect.objectContaining({ title: scan.best?.title }),
  }));
});

it('unlocks the draft and match choices after a local save fails so the user can correct and retry', async () => {
  results.set('scans:get', softScan);
  jest.spyOn(visits, 'getVisit').mockRejectedValueOnce(new Error('Local read failed'));
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  await render(result());
  await fireEvent.press(await screen.findByRole('button', { name: 'Save to collection' }));
  expect(await screen.findByText('Couldn’t save. Try again.')).toBeOnTheScreen();
  expect(screen.getByLabelText('Title').props.editable).toBe(true);
  expect(screen.getByRole('button', { name: 'Not right?' })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: LABEL_BUTTON })).toBeEnabled();
  await fireEvent.press(screen.getByRole('button', { name: 'Haystacks, Claude Monet' }));
  await fireEvent.changeText(screen.getByLabelText('Title'), 'My haystacks');
  await fireEvent.press(screen.getByRole('button', { name: 'Save to collection' }));
  await screen.findByRole('link', { name: 'Saved · View in collection' });
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

  await fireEvent.press(screen.getByRole('button', { name: 'The Japanese Footbridge, Claude Monet' }));
  await waitFor(() => expect(client.mutation).toHaveBeenCalledTimes(2));
  expect(getFunctionName(jest.mocked(client.mutation).mock.calls[1][0])).toBe('feedback:resolveRejection');
  expect(jest.mocked(client.mutation).mock.calls[1][1]).toEqual({ feedbackId: 'fb-1', resolution: { kind: 'runner_up', objectId: bridge.objectId } });
  expect(screen.queryByLabelText('Not right sheet')).toBeNull();
  expect(screen.getByText('Maybe')).toBeOnTheScreen();
  expect(screen.getByLabelText('Title').props.defaultValue).toBe('The Japanese Footbridge');
  expect(screen.queryByText('About this work')).toBeNull();
  expect(screen.getByRole('button', { name: 'Haystacks, Claude Monet' })).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Water Lilies, Claude Monet' })).toBeNull();
  expect(screen.getByText(LABEL_BUTTON)).toBeOnTheScreen();
});

it('routes to the label from the sheet and keeps the choices when feedback cannot be sent', async () => {
  mockSign.mockResolvedValue(null);
  await render(result());
  await fireEvent.press(await screen.findByRole('button', { name: 'Not right?' }));
  expect(await screen.findByText('This device can’t send feedback yet.')).toBeOnTheScreen();
  expect(client.mutation).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Haystacks, Claude Monet' })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'None of these — point at the label' }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/label/[scanId]', params: { scanId: SCAN_ID } });
  expect(screen.queryByLabelText('Not right sheet')).toBeNull();
});

it('hands a recorded rejection to the label screen so a verified label can resolve it', async () => {
  await publish(softScan);
  await render(result());
  await fireEvent.press(await screen.findByRole('button', { name: 'Not right?' }));
  await fireEvent.press(screen.getByRole('button', { name: 'None of these — point at the label' }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/label/[scanId]', params: { scanId: SCAN_ID } });
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
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/label/[scanId]', params: { scanId: SCAN_ID } });
});

it('waits for the device before querying and shows the unsupported, failed and queued states', async () => {
  mockAuth.isAuthenticated = false;
  const view = await render(result());
  expect(await screen.findByText('Identifying…')).toBeOnTheScreen();
  expect(client.watchQuery).not.toHaveBeenCalled();
  mockAuth.isAuthenticated = true;
  results.set('scans:get', unsupportedScan);
  await view.rerender(result());
  expect(await screen.findByText('Update the app to identify this painting')).toBeOnTheScreen();
  expect(screen.queryByLabelText('Title')).toBeNull();
  await publish(failedScan);
  expect(await screen.findByText('Couldn’t identify this painting')).toBeOnTheScreen();
  expect(screen.getByText('bad_features')).toBeOnTheScreen();
  await view.rerender(result('local-capture-9'));
  expect(screen.getByText('Waiting for signal')).toBeOnTheScreen();
});

it('starts a fresh card when the same screen receives another scan id', async () => {
  const view = await render(result());
  await fireEvent.press(await screen.findByRole('button', { name: 'Save to collection' }));
  await screen.findByRole('link', { name: 'Saved · View in collection' });
  results.set('scans:get', softScan);
  await view.rerender(result('scan-2'));
  expect(await screen.findByText('Maybe')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Save to collection' })).toBeOnTheScreen();
  expect(screen.queryByRole('link', { name: 'Saved · View in collection' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Not right?' })).toBeOnTheScreen();
  expect(screen.getByLabelText('Title').props.editable).toBe(true);
});

it('shows a failed card when the server refuses the scan', async () => {
  results.set('scans:get', null);
  await render(result());
  expect(await screen.findByText('Couldn’t identify this painting')).toBeOnTheScreen();
  expect(screen.queryByText(haystacks.title)).toBeNull();
});
