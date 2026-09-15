import tzLookup from '@photostructure/tz-lookup';
import { calendarDate } from '../../../shared/journal/limits';
import { socialErrorMessage } from '../../../shared/social/errors';
import { prepareCaptureVisit } from '../journal/capture-visit';
import { captureOwner, getLocalOwner, subscribeOwnerChange, useLocalOwner } from '@/lib/account/owner-store';
import { useConvexAuth, useQuery } from 'convex/react';
import { randomUUID } from 'expo-crypto';
import * as Location from 'expo-location';
import { useNetworkState } from 'expo-network';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { api } from '../../../convex/_generated/api';
import { getPoiSearch } from '../../../modules/poi-search/src';
import { getSetting, removeSetting, setSetting } from '@/db/repos/settings';
import { getVisit, patchVisit, upsertVisit } from '@/db/repos/visits';
import type { NewVisit } from '@/db/schema';
import { signPayload } from '@/lib/attested-write';
import { convex } from '@/lib/convex-client';
import { errorMessage, SyncUnavailableError } from '@/lib/network-error';
import { refreshVenueTableInBackground } from './refresh';
import { syncVisits } from './visit-sync';
import { CHOOSE_RADIUS_M, pickVenue } from './resolve';
import { applyVenueMetadata, nearest, openVenueDb, venueCoordinates } from './venue-db';
import {
  initialVenueState, isVisitFresh, needsFix, venueContext, venueReducer,
  type CurrentVisit, type SeededOption, type VenueContext, type VenueEvent, type VenueOption, type VenueState,
} from './venue-reducer';

export const CURRENT_VISIT_SETTING = 'currentVisit';
/** MapKit search radius when nothing seeded is within 400 m; a Balanced fix is good to about 100 m. */
export const POI_RADIUS_M = 300;
/** A scan never waits longer than this for a fresh fix; it then goes out with the last known context. */
export const SCAN_FIX_TIMEOUT_MS = 3000;

export type VenueController = {
  subscribe(listener: () => void): () => void;
  getState(): VenueState;
  getContext(): VenueContext;
  /** Restores the open visit from the local store; stale or ended visits are closed instead. */
  hydrate(): Promise<void>;
  /** One-shot fix, table lookup and visit bookkeeping; reuses a fix younger than three minutes. */
  resolve(): Promise<VenueContext>;
  /** The context a scan should carry: a fresh resolution when it is quick, else the last known one; a resolved venue always brings its visit. */
  resolveForScan(capturedAt: number): Promise<VenueContext>;
  /** A tap in the sheet: seeded venues start a visit; MapKit places are confirmed on the server first. */
  confirm(option: VenueOption, signal?: AbortSignal): Promise<void>;
  dismiss(): void;
  /** Flushes persisted visit starts and ends without blocking local resolution. */
  syncRemoteVisit(): Promise<void>;
  appStateChanged(status: AppStateStatus): void;
};

async function visitRow(visit: CurrentVisit): Promise<NewVisit> {
  const coordinates = await venueCoordinates(visit.venueId);
  if (!coordinates) throw new Error('The museum coordinates are not available');
  const timeZone = tzLookup(coordinates.lat, coordinates.lng);
  return { localId: visit.localId, venueId: visit.venueId, venueName: visit.venueName,
    startedAt: visit.startedAt, remoteVisitId: visit.remoteVisitId, timeZone, visitedOn: calendarDate(visit.startedAt, timeZone) };
}

export function createVenueController(): VenueController {
  let state: VenueState = initialVenueState;
  const listeners = new Set<() => void>();
  let inFlight: Promise<VenueContext> | undefined;
  let localUpdate = Promise.resolve();
  let confirmationId = 0;
  let selectionRevision = 0;
  subscribeOwnerChange(() => {
    confirmationId++; selectionRevision++;
    state = initialVenueState;
    for (const listener of listeners) listener();
  });
  const currentVisitKey = (owner = getLocalOwner()) => `${CURRENT_VISIT_SETTING}:${owner}`;

  async function syncRemoteVisit(): Promise<void> {
    const current = captureOwner();
    try {
      await syncVisits();
      if (!current.isCurrent()) return;
      const localId = state.visit?.localId;
      const row = localId ? await getVisit(localId) : undefined;
      if (row?.remoteVisitId) dispatch({ type: 'remoteVisit', localId: row.localId, remoteVisitId: row.remoteVisitId });
    } catch (error) {
      if (!(error instanceof SyncUnavailableError)) console.warn('Could not sync visits with the server', error);
    }
  }

  function updateLocally(task: () => Promise<void>): Promise<void> {
    const next = localUpdate.then(task);
    localUpdate = next.catch(() => {});
    return next;
  }

  function dispatch(event: VenueEvent): void {
    const next = venueReducer(state, event);
    if (next === state) return;
    state = next;
    for (const listener of listeners) listener();
  }

  async function closeVisit(visit: CurrentVisit, now: number, owner = getLocalOwner()): Promise<void> {
    await patchVisit(visit.localId, { endedAt: now }, owner);
    if ((await getSetting(currentVisitKey(owner))) === visit.localId) await removeSetting(currentVisitKey(owner));
    if (owner !== getLocalOwner()) return;
    dispatch({ type: 'visitEnded', localId: visit.localId });
    void syncRemoteVisit();
  }

  function endVisit(visit: CurrentVisit, now: number): Promise<void> {
    const owner = getLocalOwner();
    return updateLocally(() => closeVisit(visit, now, owner));
  }

  function ensureVisit(venue: SeededOption, now: number, wanted: () => boolean, chosen?: VenueOption): Promise<void> {
    const ownership = captureOwner();
    const stillWanted = () => ownership.isCurrent() && wanted();
    return updateLocally(async () => {
      if (!stillWanted()) return;
      const current = state.visit;
      if (!current || current.venueId !== venue.venueId || !isVisitFresh(current, now)) {
        if (current) await closeVisit(current, now, ownership.owner);
        if (!stillWanted()) return;
        const visit: CurrentVisit = { localId: randomUUID(), venueId: venue.venueId, venueName: venue.name, startedAt: now };
        const row = await visitRow(visit);
        if (!stillWanted()) return;
        await upsertVisit(row, ownership.owner);
        if (!stillWanted()) {
          await closeVisit(visit, now, ownership.owner);
          return;
        }
        await setSetting(currentVisitKey(ownership.owner), visit.localId);
        if (!stillWanted()) {
          await closeVisit(visit, now, ownership.owner);
          return;
        }
        if (chosen) {
          selectionRevision++;
          dispatch({ type: 'chosen', option: venue, replaces: chosen });
        }
        dispatch({ type: 'visitStarted', visit });
      } else if (chosen) {
        selectionRevision++;
        dispatch({ type: 'chosen', option: venue, replaces: chosen });
      }
      void syncRemoteVisit();
    });
  }

  async function searchNearbyPlaces(fix: { lat: number; lng: number }): Promise<void> {
    const ownership = captureOwner();
    try {
      const places = await getPoiSearch().searchNearby(fix.lat, fix.lng, POI_RADIUS_M);
      if (!ownership.isCurrent()) return;
      dispatch({
        type: 'poiOptions',
        options: places.map((place) => ({
          kind: 'poi', name: place.name, lat: place.lat, lng: place.lng, distanceM: place.distanceMeters,
          category: place.category, city: place.city, country: place.country, ...(place.website ? { website: place.website } : {}),
        })),
      });
    } catch (error) {
      console.warn('Nearby place search failed', error);
    }
  }

  async function hydrate(): Promise<void> {
    const ownership = captureOwner();
    const owner = ownership.owner;
    const localId = await getSetting(currentVisitKey(owner));
    const row = localId ? await getVisit(localId, owner) : undefined;
    if (!ownership.isCurrent()) return;
    const now = Date.now();
    if (row && row.startedAt !== null && row.endedAt === null && isVisitFresh({ startedAt: row.startedAt }, now)) {
      dispatch({
        type: 'hydrated',
        visit: { localId: row.localId, venueId: row.venueId, venueName: row.venueName, startedAt: row.startedAt, remoteVisitId: row.remoteVisitId ?? undefined },
      });
      return;
    }
    if (row && row.startedAt !== null && row.endedAt === null) await endVisit({ ...row, startedAt: row.startedAt, remoteVisitId: row.remoteVisitId ?? undefined }, now);
    if (localId) await removeSetting(currentVisitKey(owner));
    dispatch({ type: 'hydrated' });
  }

  async function runResolve(): Promise<VenueContext> {
    void syncRemoteVisit();
    if (!needsFix(state, Date.now())) return venueContext(state);
    const revision = selectionRevision;
    const wanted = () => revision === selectionRevision;
    dispatch({ type: 'locating' });
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!wanted()) return venueContext(state);
      if (!permission.granted) {
        const before = state.visit;
        dispatch({ type: 'denied' });
        if (before) await endVisit(before, Date.now());
        return venueContext(state);
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      if (!wanted()) return venueContext(state);
      const fix = { lat: position.coords.latitude, lng: position.coords.longitude, at: Date.now() };
      const resolution = pickVenue(await nearest(await openVenueDb(), fix, CHOOSE_RADIUS_M));
      if (!wanted()) return venueContext(state);
      if (__DEV__) console.debug('Venue resolved', resolution.kind, resolution.kind === 'none' ? '' : resolution.options.map((row) => `${row.name} ${Math.round(row.distanceM)} m`));
      const before = state.visit;
      dispatch({ type: 'resolved', fix, resolution });
      if (state.status === 'resolved' && state.venue) {
        const venue = state.venue;
        await ensureVisit(venue, fix.at, () => wanted() && state.venue?.venueId === venue.venueId);
      } else if (state.status === 'none') {
        if (before) await endVisit(before, fix.at);
        if (resolution.kind === 'none') await searchNearbyPlaces(fix);
      }
      return venueContext(state);
    } catch (error) {
      if (!wanted()) return venueContext(state);
      console.warn('Venue resolution failed', error);
      dispatch({ type: 'failed', error: socialErrorMessage(error) ?? errorMessage(error) });
      return venueContext(state);
    }
  }

  function resolve(): Promise<VenueContext> {
    inFlight ??= runResolve().finally(() => { inFlight = undefined; });
    return inFlight;
  }

  async function resolveForScan(capturedAt: number): Promise<VenueContext> {
    const ownership = captureOwner();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<VenueContext>((settle) => {
      timer = setTimeout(() => settle(venueContext(state)), SCAN_FIX_TIMEOUT_MS);
    });
    let context = await Promise.race([resolve(), timeout]).finally(() => clearTimeout(timer));
    if (!ownership.isCurrent()) throw new Error('Journal owner changed');
    if (context.venueId && !context.visitLocalId) {
      // The fix resolved but its visit bookkeeping is still queued or failed: finish it here so the
      // scan joins the controller's visit instead of starting one it never tracks.
      await localUpdate;
      const venue = state.venue;
      if (ownership.isCurrent() && venue && state.visit?.venueId !== venue.venueId) {
        await ensureVisit(venue, Date.now(), () => state.venue?.venueId === venue.venueId)
          .catch((error: unknown) => console.warn('Could not start the visit for the scan', error));
      }
      if (!ownership.isCurrent()) throw new Error('Journal owner changed');
      context = venueContext(state);
    }
    return prepareCaptureVisit(context, capturedAt);
  }

  async function confirm(option: VenueOption, signal?: AbortSignal): Promise<void> {
    const ownership = captureOwner();
    const requestId = ++confirmationId;
    const wanted = () => ownership.isCurrent() && requestId === confirmationId && !signal?.aborted;
    if (!wanted()) return;
    let venue: SeededOption;
    if (option.kind === 'seeded') {
      venue = option;
    } else {
      const fields = { city: option.city, country: option.country, name: option.name, lat: option.lat, lng: option.lng, ...(option.website ? { website: option.website } : {}) };
      const signed = await signPayload({ action: 'museums.confirmPoiVenue', ...fields });
      if (!wanted()) return;
      if (!signed) throw new Error('This device cannot confirm a new venue');
      const { venueId, venue: confirmed } = await convex.mutation(api.museums.confirmPoiVenue, { ...fields, ...signed });
      if (!wanted()) return;
      try {
        const db = await openVenueDb();
        if (!wanted()) return;
        await applyVenueMetadata(db, [confirmed]);
      } catch (error) {
        console.warn('Could not add the confirmed venue to the local table', error);
      }
      venue = { kind: 'seeded', venueId, name: confirmed.name, distanceM: option.distanceM, ...(confirmed.website ? { website: confirmed.website } : {}) };
    }
    await ensureVisit(venue, Date.now(), wanted, option);
  }

  function dismiss(): void {
    confirmationId++;
    const before = state.visit;
    dispatch({ type: 'dismissed' });
    if (before && !state.visit) {
      void endVisit(before, Date.now()).catch((error: unknown) => console.warn('Could not end the visit', error));
    }
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getState: () => state,
    getContext: () => venueContext(state),
    hydrate,
    resolve,
    resolveForScan,
    confirm,
    dismiss,
    syncRemoteVisit,
    appStateChanged(status) {
      if (status === 'background') dispatch({ type: 'backgrounded' });
      else if (status === 'active') void resolve();
    },
  };
}

export const venueController = createVenueController();

export function resolveVenueForScan(capturedAt: number): Promise<VenueContext> {
  return venueController.resolveForScan(capturedAt);
}

export type VenueView = {
  status: VenueState['status'];
  venue?: SeededOption;
  visitId?: VenueContext['visitId'];
  options: VenueOption[];
  error?: string;
  resolve: VenueController['resolve'];
  confirm: VenueController['confirm'];
  dismiss: VenueController['dismiss'];
};

export function useVenue(controller: VenueController = venueController): VenueView {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  return {
    status: snapshot.status, venue: snapshot.venue, visitId: venueContext(snapshot).visitId, options: snapshot.options,
    error: snapshot.error, resolve: controller.resolve, confirm: controller.confirm, dismiss: controller.dismiss,
  };
}

/** Mounted once under the database gate: resolves on launch and foreground, opens the sheet, syncs the visit. */
export function VenueResolver({ controller = venueController }: { controller?: VenueController }): null {
  const owner = useLocalOwner();
  const router = useRouter();
  const { isAuthenticated } = useConvexAuth();
  const device = useQuery(api.devices.me, isAuthenticated ? {} : 'skip');
  const { isInternetReachable } = useNetworkState();
  const prompt = useSyncExternalStore(controller.subscribe, () => controller.getState().prompt, () => controller.getState().prompt);
  const seenPrompt = useRef(prompt);

  useEffect(() => {
    void controller.hydrate().then(controller.resolve, (error: unknown) => console.warn('Could not restore the visit', error));
    refreshVenueTableInBackground();
    const subscription = AppState.addEventListener('change', controller.appStateChanged);
    return () => subscription.remove();
  }, [controller, owner]);

  useEffect(() => {
    if (device && isInternetReachable !== false) void controller.syncRemoteVisit();
  }, [controller, device, isInternetReachable]);

  useEffect(() => {
    if (prompt === seenPrompt.current) return;
    seenPrompt.current = prompt;
    router.push('/venue-picker');
  }, [prompt, router]);

  return null;
}
