import { act, render } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';

import type { Id } from '../../../convex/_generated/dataModel';
import type { NewVisit, Visit } from '@/db/schema';
import type { VenueCandidate } from './resolve';
import { createVenueController, VenueResolver, type VenueController } from './use-venue';

const mockRequestPermission = jest.fn();
const mockGetPosition = jest.fn();
const mockPush = jest.fn();
const mockMutation = jest.fn();
const mockSearchNearby = jest.fn();
const mockNearest = jest.fn();
const mockInsertConfirmed = jest.fn();
const mockCoordinates = jest.fn();
const mockSignPayload = jest.fn();
const mockRefresh = jest.fn();
const mockAuth = { isAuthenticated: true };
let mockReachable = true;
const mockSettings = new Map<string, string>();
const mockVisits = new Map<string, Visit>();
let mockActivity: number | undefined;
let mockNow = 1_000_000;
let mockUuid = 0;

jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  requestForegroundPermissionsAsync: () => mockRequestPermission(),
  getCurrentPositionAsync: (...args: unknown[]) => mockGetPosition(...args),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => `uuid-${++mockUuid}` }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('convex/react', () => ({ useConvexAuth: () => mockAuth, useQuery: () => mockAuth.isAuthenticated ? 'registered' : null }));
jest.mock('expo-network', () => ({ useNetworkState: () => ({ isInternetReachable: mockReachable }) }));
jest.mock('../../../convex/_generated/api', () => ({
  api: { devices: { me: 'me' }, museums: { confirmPoiVenue: 'confirmPoiVenue' } },
}));
jest.mock('../../../modules/poi-search/src', () => ({
  getPoiSearch: () => ({ searchNearby: (...args: unknown[]) => mockSearchNearby(...args) }),
}));
jest.mock('@/db/repos/settings', () => ({
  getSetting: async (key: string) => mockSettings.get(key),
  setSetting: async (key: string, value: string) => { mockSettings.set(key, value); },
  removeSetting: async (key: string) => { mockSettings.delete(key); },
}));
jest.mock('@/db/repos/visits', () => ({
  upsertVisit: async (visit: NewVisit) => {
    const existing = mockVisits.get(visit.localId);
    const merged = { owner: 'device:test-installation', endedAt: null, remoteVisitId: null, visitedOn: '1970-01-01', timeZone: 'America/New_York', reflection: null, syncedAt: null, syncedBy: null, revision: 0, ...existing, ...Object.fromEntries(Object.entries(visit).filter(([, v]) => v !== undefined)) } as Visit;
    mockVisits.set(visit.localId, merged);
  },
  getVisit: async (localId: string) => mockVisits.get(localId),
  latestVisitActivity: async () => mockActivity,
  patchVisit: async (localId: string, fields: Partial<Visit>) => {
    const row = mockVisits.get(localId);
    if (row) mockVisits.set(localId, { ...row, ...fields, syncedAt: null });
  },

}));
jest.mock('@/lib/attested-write', () => ({ signPayload: (...args: unknown[]) => mockSignPayload(...args) }));
jest.mock('@/lib/convex-client', () => ({ convex: { mutation: (...args: unknown[]) => mockMutation(...args) } }));
jest.mock('./venue-db', () => ({
  venueCoordinates: (...args: unknown[]) => mockCoordinates(...args),
  openVenueDb: async () => 'venue-db',
  nearest: (...args: unknown[]) => mockNearest(...args),
  applyVenueMetadata: (...args: unknown[]) => mockInsertConfirmed(...args),
}));
let mockSyncRunning: Promise<void> | undefined;
jest.mock('@/lib/account/collection-sync', () => ({ flushJournal: async () => {
  if (mockSyncRunning) await mockSyncRunning;
  mockSyncRunning = (async () => {
    for (const visit of mockVisits.values()) {
      if (visit.syncedAt !== null) continue;
      const result = await mockMutation('syncVisit', { ...visit });
      visit.remoteVisitId = result?.visitId ?? visit.remoteVisitId;
      visit.syncedAt = mockNow;
    }
  })();
  try { await mockSyncRunning; } finally { mockSyncRunning = undefined; }
} }));
jest.mock('./refresh', () => ({ refreshVenueTableInBackground: () => mockRefresh() }));

const met = { lat: 40.779444444, lng: -73.963333333 };
const metRow: VenueCandidate = { id: 'id-met' as Id<'museums'>, key: 'wikidata:Q160236', name: 'Metropolitan Museum of Art', ...met, website: 'https://www.metmuseum.org/', region: 'new-york', distanceM: 40 };
const neueRow: VenueCandidate = { ...metRow, id: 'id-neue' as Id<'museums'>, key: 'wikidata:Q1', name: 'Neue Galerie', website: null, distanceM: 320 };
const place = { name: 'Corner Gallery', lat: 40.78, lng: -73.96, website: 'https://corner.example', category: 'unknown', distanceMeters: 80 };

let controller: VenueController;
let appStateListener: ((state: AppStateStatus) => void) | undefined;

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(Date, 'now').mockImplementation(() => mockNow);
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    appStateListener = listener;
    return { remove: jest.fn() };
  });
  mockNow = 1_000_000;
  mockActivity = undefined;
  mockUuid = 0;
  mockAuth.isAuthenticated = true;
  mockReachable = true;
  mockSettings.clear();
  mockVisits.clear();
  mockRequestPermission.mockResolvedValue({ granted: true });
  mockGetPosition.mockResolvedValue({ coords: { latitude: met.lat, longitude: met.lng }, timestamp: mockNow });
  mockNearest.mockResolvedValue([]);
  mockSearchNearby.mockResolvedValue([]);
  mockMutation.mockImplementation(async (ref: string) => ref === 'syncVisit' ? { visitId: 'remote-1' } : { venueId: 'id-corner', venue: { id: 'id-corner', key: 'poi:corner', region: 'US', name: 'Corner Gallery', lat: 40.8, lng: -73.9 } });
  mockSignPayload.mockResolvedValue({ nonce: 'nonce', assertionBase64: 'assertion', payloadJson: '{}' });
  mockInsertConfirmed.mockResolvedValue(undefined);
  mockCoordinates.mockResolvedValue({ lat: 40.779, lng: -73.963 });
  controller = createVenueController();
});
afterEach(() => jest.restoreAllMocks());

async function mountResolver() {
  await act(async () => { await render(<VenueResolver controller={controller} />); });
  await act(async () => { await controller.resolve(); });
}

it('resolves a single nearby venue, persists a local visit and starts it on the server', async () => {
  mockNearest.mockResolvedValue([metRow]);
  await controller.resolve();
  await controller.syncRemoteVisit();
  expect(controller.getContext()).toEqual({ visitLocalId: 'uuid-1', venueId: 'id-met', visitId: 'remote-1' });
  expect(mockGetPosition).toHaveBeenCalledWith({ accuracy: 3 });
  expect(mockNearest).toHaveBeenCalledWith('venue-db', { lat: met.lat, lng: met.lng, at: mockNow }, 400);
  expect(mockMutation).toHaveBeenCalledWith('syncVisit', expect.objectContaining({ venueId: 'id-met', localId: 'uuid-1' }));
  expect(mockVisits.get('uuid-1')).toMatchObject({ venueId: 'id-met', venueName: 'Metropolitan Museum of Art', startedAt: mockNow, endedAt: null, remoteVisitId: 'remote-1' });
  expect(mockSettings.get('currentVisit:device:test-installation')).toBe('uuid-1');
  expect(controller.getState().status).toBe('resolved');
});

it('reuses the fix for three minutes and asks again after the app was backgrounded', async () => {
  mockNearest.mockResolvedValue([metRow]);
  await mountResolver();
  expect(mockGetPosition).toHaveBeenCalledTimes(1);
  mockNow += 2 * 60 * 1000;
  await act(async () => { await controller.resolve(); });
  expect(mockGetPosition).toHaveBeenCalledTimes(1);
  await act(async () => { appStateListener?.('background'); appStateListener?.('active'); });
  expect(mockGetPosition).toHaveBeenCalledTimes(2);
  expect(mockVisits.size).toBe(1);
  expect(mockRefresh).toHaveBeenCalledTimes(1);
});

it('asks between two seeded venues, opens the picker once, and a choice starts that visit', async () => {
  mockNearest.mockResolvedValue([metRow, neueRow]);
  await mountResolver();
  expect(controller.getState().status).toBe('choose');
  expect(mockPush).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/venue-picker', params: { mode: 'choose' } });
  expect(controller.getContext()).toEqual({});
  expect(mockMutation).not.toHaveBeenCalled();
  const option = controller.getState().options[1];
  await act(async () => { await controller.confirm(option); });
  expect(mockMutation).toHaveBeenCalledWith('syncVisit', expect.objectContaining({ venueId: 'id-neue', localId: 'uuid-1' }));
  expect(controller.getContext()).toEqual({ visitLocalId: 'uuid-1', venueId: 'id-neue', visitId: 'remote-1' });
});

it('searches MapKit when nothing seeded is near and confirms a place through the attested mutation', async () => {
  mockSearchNearby.mockResolvedValue([place]);
  await mountResolver();
  expect(mockSearchNearby).toHaveBeenCalledWith(met.lat, met.lng, 300);
  expect(controller.getState()).toMatchObject({ status: 'none', options: [{ kind: 'poi', name: 'Corner Gallery', distanceM: 80 }] });
  expect(mockPush).toHaveBeenCalledTimes(1);
  await act(async () => { await controller.confirm(controller.getState().options[0]); });
  const fields = { name: 'Corner Gallery', lat: 40.78, lng: -73.96, website: 'https://corner.example' };
  expect(mockSignPayload).toHaveBeenCalledWith({ action: 'museums.confirmPoiVenue', ...fields });
  expect(mockMutation).toHaveBeenCalledWith('confirmPoiVenue', { ...fields, nonce: 'nonce', assertionBase64: 'assertion', payloadJson: '{}' });
  expect(mockInsertConfirmed).toHaveBeenCalledWith('venue-db', [expect.objectContaining({ id: 'id-corner', name: 'Corner Gallery' })]);
  expect(mockMutation).toHaveBeenCalledWith('syncVisit', expect.objectContaining({ venueId: 'id-corner', localId: 'uuid-1' }));
  expect(controller.getContext()).toEqual({ visitLocalId: 'uuid-1', venueId: 'id-corner', visitId: 'remote-1' });
});

it('does not open the picker when MapKit finds nothing, and refuses a place on a device that cannot attest', async () => {
  await mountResolver();
  expect(controller.getState().status).toBe('none');
  expect(mockPush).not.toHaveBeenCalled();
  mockSignPayload.mockResolvedValue(null);
  await expect(controller.confirm({ kind: 'poi', name: 'X', lat: 1, lng: 2, distanceM: 5, category: 'unknown' })).rejects.toThrow('cannot confirm');
  expect(mockMutation).not.toHaveBeenCalled();
});

it('pauses the visit when a later fix finds nothing nearby and resumes it on return', async () => {
  mockNearest.mockResolvedValueOnce([metRow]).mockResolvedValueOnce([]).mockResolvedValueOnce([metRow]);
  await controller.resolve();
  mockNow += 10 * 60 * 1000;
  await expect(controller.resolve()).resolves.toEqual({});
  expect(mockVisits.get('uuid-1')).toMatchObject({ endedAt: null });
  expect(mockSettings.get('currentVisit:device:test-installation')).toBe('uuid-1');
  expect(controller.getState().visit?.localId).toBe('uuid-1');
  mockNow += 10 * 60 * 1000;
  await expect(controller.resolve()).resolves.toMatchObject({ venueId: 'id-met', visitLocalId: 'uuid-1' });
  expect(mockVisits.size).toBe(1);
});

it('does not restart a visit ended by hand from location alone that day, but does on a confirmed choice', async () => {
  mockNearest.mockResolvedValue([metRow]);
  await controller.resolve();
  await controller.end();
  expect(mockSettings.get('endedVisit:device:test-installation')).toBe('uuid-1');
  mockNow += 5 * 60 * 1000;
  await expect(controller.resolve()).resolves.toEqual({ venueId: 'id-met' });
  expect(mockVisits.size).toBe(1);
  expect(controller.getState().visit).toBeUndefined();
  // A relaunch the same day remembers the ending.
  const relaunched = createVenueController();
  await relaunched.hydrate();
  await expect(relaunched.resolve()).resolves.toEqual({ venueId: 'id-met' });
  expect(mockVisits.size).toBe(1);
  await relaunched.confirm(relaunched.getState().options[0]);
  expect(mockVisits.size).toBe(2);
  expect(relaunched.getContext()).toMatchObject({ venueId: 'id-met', visitLocalId: 'uuid-2' });
  expect(mockSettings.has('endedVisit:device:test-installation')).toBe(false);
});

it('starts a visit again at that museum the next day after an ending by hand', async () => {
  mockNearest.mockResolvedValue([metRow]);
  await controller.resolve();
  await controller.end();
  mockNow += 24 * 60 * 60 * 1000;
  const relaunched = createVenueController();
  await relaunched.hydrate();
  expect(mockSettings.has('endedVisit:device:test-installation')).toBe(false);
  await expect(relaunched.resolve()).resolves.toMatchObject({ venueId: 'id-met', visitLocalId: 'uuid-2' });
});

it('ends the visit on End and syncs the ending', async () => {
  mockNearest.mockResolvedValue([metRow]);
  await controller.resolve();
  await controller.syncRemoteVisit();
  mockNow += 10 * 60 * 1000;
  await controller.end();
  await controller.syncRemoteVisit();
  expect(mockVisits.get('uuid-1')).toMatchObject({ endedAt: mockNow, remoteVisitId: 'remote-1' });
  expect(mockMutation).toHaveBeenCalledWith('syncVisit', expect.objectContaining({ remoteVisitId: 'remote-1', endedAt: mockNow }));
  expect(mockSettings.has('currentVisit:device:test-installation')).toBe(false);
  expect(controller.getState().visit).toBeUndefined();
  expect(controller.getContext()).toEqual({ venueId: 'id-met' });
  await controller.end();
  expect(mockVisits.size).toBe(1);
});

it('moves to a new visit when a later fix resolves a different venue', async () => {
  mockNearest.mockResolvedValueOnce([metRow]).mockResolvedValueOnce([{ ...neueRow, distanceM: 30 }]);
  await controller.resolve();
  mockNow += 10 * 60 * 1000;
  mockMutation.mockResolvedValue({ visitId: 'remote-2' });
  await controller.resolve();
  await controller.syncRemoteVisit();
  expect(controller.getContext()).toEqual({ visitLocalId: 'uuid-2', venueId: 'id-neue', visitId: 'remote-2' });
  expect(mockVisits.get('uuid-1')).toMatchObject({ endedAt: mockNow });
  expect(mockVisits.get('uuid-2')).toMatchObject({ venueId: 'id-neue', endedAt: null, remoteVisitId: 'remote-2' });
  expect(mockSettings.get('currentVisit:device:test-installation')).toBe('uuid-2');
});

it('restores an open visit and resumes it instead of starting another local one', async () => {
  mockVisits.set('existing', { visibility: 'public' as const, owner: 'device:test-installation', localId: 'existing', venueId: 'id-met' as Id<'museums'>, venueName: 'Metropolitan Museum of Art', startedAt: mockNow - 10 * 60 * 1000, endedAt: null, remoteVisitId: null, visitedOn: '1970-01-01', timeZone: 'UTC', reflection: null, syncedAt: null, syncedBy: null, revision: 0 });
  mockSettings.set('currentVisit:device:test-installation', 'existing');
  mockNearest.mockResolvedValue([metRow]);
  await controller.hydrate();
  expect(controller.getContext()).toEqual({ visitLocalId: 'existing', venueId: 'id-met' });
  await controller.resolve();
  await controller.syncRemoteVisit();
  expect(controller.getContext()).toEqual({ visitLocalId: 'existing', venueId: 'id-met', visitId: 'remote-1' });
  expect(mockVisits.size).toBe(1);
  expect(mockMutation).toHaveBeenCalledWith('syncVisit', expect.objectContaining({ venueId: 'id-met', localId: 'existing' }));
});

it('closes a visit from an earlier day at launch, ending it with its last saved artwork', async () => {
  const startedAt = mockNow - 5 * 60 * 60 * 1000;
  mockVisits.set('stale', { visibility: 'public' as const, owner: 'device:test-installation', localId: 'stale', venueId: 'id-met' as Id<'museums'>, venueName: 'Met', startedAt, endedAt: null, remoteVisitId: 'remote-old' as Id<'visits'>, visitedOn: '1969-12-31', timeZone: 'UTC', reflection: null, syncedAt: null, syncedBy: null, revision: 0 });
  mockSettings.set('currentVisit:device:test-installation', 'stale');
  mockActivity = mockNow - 60 * 60 * 1000;
  await controller.hydrate();
  expect(mockVisits.get('stale')).toMatchObject({ endedAt: mockActivity });
  expect(mockSettings.has('currentVisit:device:test-installation')).toBe(false);
  expect(controller.getContext()).toEqual({});
});

it('closes an earlier day\'s visit with no artworks at its start time', async () => {
  const startedAt = mockNow - 5 * 60 * 60 * 1000;
  mockVisits.set('empty', { visibility: 'public' as const, owner: 'device:test-installation', localId: 'empty', venueId: 'id-met' as Id<'museums'>, venueName: 'Met', startedAt, endedAt: null, remoteVisitId: null, visitedOn: '1969-12-31', timeZone: 'UTC', reflection: null, syncedAt: null, syncedBy: null, revision: 0 });
  mockSettings.set('currentVisit:device:test-installation', 'empty');
  await controller.hydrate();
  expect(mockVisits.get('empty')).toMatchObject({ endedAt: startedAt });
});

it('records a denied permission without asking for a position', async () => {
  mockRequestPermission.mockResolvedValue({ granted: false });
  await expect(controller.resolve()).resolves.toEqual({});
  expect(mockGetPosition).not.toHaveBeenCalled();
  expect(controller.getState().status).toBe('denied');
});

it('keeps the last venue when the fix fails and reports the error', async () => {
  mockNearest.mockResolvedValue([metRow]);
  await controller.resolve();
  mockNow += 10 * 60 * 1000;
  mockGetPosition.mockRejectedValue(new Error('Location services are disabled'));
  await controller.resolve();
  await controller.syncRemoteVisit();
  expect(controller.getContext()).toEqual({ visitLocalId: 'uuid-1', venueId: 'id-met', visitId: 'remote-1' });
  expect(controller.getState()).toMatchObject({ status: 'resolved', error: 'Location services are disabled' });
});

it('lets a scan go out with the last context when the fix takes longer than three seconds', async () => {
  jest.useFakeTimers();
  try {
    mockGetPosition.mockReturnValue(new Promise(() => {}));
    const pending = controller.resolveForScan(mockNow);
    jest.advanceTimersByTime(3000);
    await expect(pending).resolves.toEqual({});
    expect(controller.getState().status).toBe('locating');
  } finally {
    jest.useRealTimers();
  }
});

it('joins the visit of a fix that lands just before the scan timeout instead of starting a second one', async () => {
  jest.useFakeTimers();
  try {
    mockNearest.mockResolvedValue([metRow]);
    const coordinates = deferred<{ lat: number; lng: number }>();
    mockCoordinates.mockReturnValueOnce(coordinates.promise);
    const pending = controller.resolveForScan(mockNow - 500);
    await jest.advanceTimersByTimeAsync(3000);
    expect(controller.getContext()).toEqual({ venueId: 'id-met' });
    coordinates.resolve(met);
    await expect(pending).resolves.toMatchObject({ venueId: 'id-met', visitLocalId: 'uuid-1' });
    expect([...mockVisits.keys()]).toEqual(['uuid-1']);
    expect(mockVisits.get('uuid-1')).toMatchObject({ startedAt: mockNow - 500, endedAt: null });
    expect(mockSettings.get('currentVisit:device:test-installation')).toBe('uuid-1');
  } finally {
    jest.useRealTimers();
  }
});

it('starts a tracked visit for a scan when the resolved venue has none', async () => {
  mockNearest.mockResolvedValue([metRow]);
  mockCoordinates.mockRejectedValueOnce(new Error('table busy'));
  await controller.resolve();
  expect(controller.getState()).toMatchObject({ status: 'resolved', error: 'table busy' });
  expect(controller.getContext()).toEqual({ venueId: 'id-met' });
  mockCoordinates.mockRejectedValueOnce(new Error('still busy'));
  await expect(controller.resolveForScan(mockNow)).resolves.toEqual({ venueId: 'id-met' });
  expect(mockVisits.size).toBe(0);
  expect(console.warn).toHaveBeenCalledWith('Could not start the visit for the scan', expect.any(Error));
  await expect(controller.resolveForScan(mockNow)).resolves.toMatchObject({ venueId: 'id-met', visitLocalId: 'uuid-1' });
  await controller.syncRemoteVisit();
  expect(controller.getContext()).toEqual({ venueId: 'id-met', visitLocalId: 'uuid-1', visitId: 'remote-1' });
  expect([...mockVisits.keys()]).toEqual(['uuid-1']);
  await expect(controller.resolveForScan(mockNow)).resolves.toEqual({ venueId: 'id-met', visitLocalId: 'uuid-1', visitId: 'remote-1' });
  expect(mockVisits.size).toBe(1);
});

it('starts the server visit later when the session was not ready at resolution', async () => {
  mockAuth.isAuthenticated = false;
  mockNearest.mockResolvedValue([metRow]);
  mockMutation.mockRejectedValue(new Error('unauthenticated'));
  const view = await render(<VenueResolver controller={controller} />);
  await act(async () => { await controller.resolve(); });
  expect(controller.getContext()).toEqual({ visitLocalId: 'uuid-1', venueId: 'id-met' });
  expect(mockVisits.get('uuid-1')).toMatchObject({ remoteVisitId: null });
  mockAuth.isAuthenticated = true;
  mockMutation.mockResolvedValue({ visitId: 'remote-1' });
  await act(async () => { await view.rerender(<VenueResolver controller={controller} />); });
  expect(mockMutation).toHaveBeenLastCalledWith('syncVisit', expect.objectContaining({ venueId: 'id-met', localId: 'uuid-1' }));
  expect(controller.getContext()).toEqual({ visitLocalId: 'uuid-1', venueId: 'id-met', visitId: 'remote-1' });
});

it('"Not here" keeps a visit paused elsewhere and does not reopen the sheet nearby', async () => {
  mockVisits.set('old', { visibility: 'public' as const, owner: 'device:test-installation', localId: 'old', venueId: 'id-old' as Id<'museums'>, venueName: 'Old', startedAt: mockNow - 1000, endedAt: null, remoteVisitId: null, visitedOn: '1970-01-01', timeZone: 'UTC', reflection: null, syncedAt: null, syncedBy: null, revision: 0 });
  mockSettings.set('currentVisit:device:test-installation', 'old');
  mockNearest.mockResolvedValue([metRow, neueRow]);
  await act(async () => { await render(<VenueResolver controller={controller} />); });
  expect(mockPush).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/venue-picker', params: { mode: 'choose' } });
  await act(async () => { controller.dismiss(); });
  expect(mockVisits.get('old')).toMatchObject({ endedAt: null });
  expect(mockSettings.get('currentVisit:device:test-installation')).toBe('old');
  expect(controller.getState().visit?.localId).toBe('old');
  expect(controller.getContext()).toEqual({});
  mockNow += 5 * 60 * 1000;
  await act(async () => { await controller.resolve(); });
  expect(mockGetPosition).toHaveBeenCalledTimes(2);
  expect(mockPush).toHaveBeenCalledTimes(1);
});


function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => { resolve = settle; });
  return { promise, resolve };
}

it('keeps resolving local venues and confirming seeded choices while the server is offline', async () => {
  const remote = deferred<{ visitId: string }>();
  mockMutation.mockReturnValueOnce(remote.promise);
  mockNearest.mockResolvedValueOnce([metRow]).mockResolvedValueOnce([{ ...neueRow, distanceM: 30 }]);
  await expect(controller.resolve()).resolves.toEqual({ visitLocalId: 'uuid-1', venueId: 'id-met' });
  mockNow += 5 * 60 * 1000;
  await expect(controller.resolve()).resolves.toEqual({ visitLocalId: 'uuid-2', venueId: 'id-neue' });
  await controller.confirm(controller.getState().options[0]);
  expect(mockGetPosition).toHaveBeenCalledTimes(2);
  expect(mockVisits.size).toBe(2);
  remote.resolve({ visitId: 'remote-old' });
  await controller.syncRemoteVisit();
  expect(mockVisits.get('uuid-2')?.remoteVisitId).toBeTruthy();
  expect(mockVisits.get('uuid-1')?.endedAt).toBe(mockNow);
});

it('honors Not here when a subsequent fix automatically finds the same venue', async () => {
  mockNearest.mockResolvedValue([metRow]);
  await controller.resolve();
  controller.dismiss();
  mockNow += 5 * 60 * 1000;
  await controller.resolve();
  expect(controller.getContext()).toEqual({});
  expect(mockVisits.size).toBe(1);
  await controller.confirm(controller.getState().options[0]);
  expect(controller.getContext().venueId).toBe('id-met');
});

it('ignores a POI confirmation dismissed while signing', async () => {
  mockSearchNearby.mockResolvedValue([place]);
  await controller.resolve();
  const signed = deferred<{ nonce: string; assertionBase64: string; payloadJson: string }>();
  mockSignPayload.mockReturnValue(signed.promise);
  const confirming = controller.confirm(controller.getState().options[0]);
  controller.dismiss();
  signed.resolve({ nonce: 'nonce', assertionBase64: 'assertion', payloadJson: '{}' });
  await confirming;
  expect(controller.getContext()).toEqual({});
  expect(mockMutation).not.toHaveBeenCalled();
  expect(mockVisits.size).toBe(0);
});

it('does not start a visit if the sheet unmounts while the server confirms a POI', async () => {
  mockSearchNearby.mockResolvedValue([place]);
  await controller.resolve();
  const remote = deferred<{ venueId: string; venue: { id: string; key: string; region: string; name: string; lat: number; lng: number } }>();
  mockMutation.mockReturnValueOnce(remote.promise);
  const abort = new AbortController();
  const confirming = controller.confirm(controller.getState().options[0], abort.signal);
  await Promise.resolve();
  abort.abort();
  remote.resolve({ venueId: 'id-corner', venue: { id: 'id-corner', key: 'poi:corner', region: 'US', name: 'Corner Gallery', lat: 40.8, lng: -73.9 } });
  await confirming;
  expect(controller.getContext()).toEqual({});
  expect(mockVisits.size).toBe(0);
  expect(mockInsertConfirmed).not.toHaveBeenCalled();
});


it('retries an unsent visit ending when connectivity returns', async () => {
  mockNearest.mockResolvedValue([metRow]);
  const view = await render(<VenueResolver controller={controller} />);
  await act(async () => { await controller.resolve(); await controller.syncRemoteVisit(); });
  mockReachable = false;
  await view.rerender(<VenueResolver controller={controller} />);
  mockMutation.mockRejectedValue(new Error('offline'));
  await act(async () => { controller.dismiss(); });
  await controller.syncRemoteVisit();
  expect(mockVisits.get('uuid-1')).toMatchObject({ endedAt: mockNow, syncedAt: null });
  mockMutation.mockResolvedValue(null);
  mockReachable = true;
  await act(async () => { await view.rerender(<VenueResolver controller={controller} />); });
  expect(mockMutation).toHaveBeenLastCalledWith('syncVisit', expect.objectContaining({ remoteVisitId: 'remote-1', endedAt: mockNow }));
  expect(mockVisits.get('uuid-1')).toMatchObject({ syncedAt: mockNow });
});

it.each(['none', 'auto'] as const)('keeps a confirmed visit when an older fix returns %s', async (result) => {
  mockNearest.mockResolvedValueOnce([metRow, neueRow]);
  await controller.resolve();
  const selected = controller.getState().options[1];
  mockNow += 5 * 60 * 1000;
  const fix = deferred<{ coords: { latitude: number; longitude: number } }>();
  mockGetPosition.mockReturnValueOnce(fix.promise);
  mockNearest.mockResolvedValueOnce(result === 'none' ? [] : [metRow]);
  const resolving = controller.resolve();
  await Promise.resolve();
  await controller.confirm(selected);
  fix.resolve({ coords: { latitude: met.lat, longitude: met.lng } });
  await resolving;
  await controller.syncRemoteVisit();
  expect(controller.getContext().venueId).toBe('id-neue');
  expect([...mockVisits.values()].filter((visit) => visit.endedAt === null)).toEqual([
    expect.objectContaining({ localId: 'uuid-1', venueId: 'id-neue' }),
  ]);
  expect(mockSettings.get('currentVisit:device:test-installation')).toBe('uuid-1');
  await controller.hydrate();
  expect(controller.getContext().venueId).toBe('id-neue');
});

it('keeps the other same-name place available after confirming one branch', async () => {
  const otherBranch = { ...place, lat: place.lat + 0.001, distanceMeters: 190 };
  mockSearchNearby.mockResolvedValue([place, otherBranch]);
  await controller.resolve();
  await controller.confirm(controller.getState().options[0]);
  expect(controller.getState().options).toEqual([
    expect.objectContaining({ kind: 'seeded', venueId: 'id-corner' }),
    expect.objectContaining({ kind: 'poi', name: place.name, lat: otherBranch.lat }),
  ]);
});
