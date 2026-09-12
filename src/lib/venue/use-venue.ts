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
import { errorMessage } from '@/lib/network-error';
import { refreshVenueTableInBackground } from './refresh';
import { syncVisits } from './visit-sync';
import { CHOOSE_RADIUS_M, pickVenue } from './resolve';
import { insertConfirmedVenue, nearest, openVenueDb } from './venue-db';
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
  /** The context a scan should carry: a fresh resolution when it is quick, else the last known one. */
  resolveForScan(): Promise<VenueContext>;
  /** A tap in the sheet: seeded venues start a visit; MapKit places are confirmed on the server first. */
  confirm(option: VenueOption, signal?: AbortSignal): Promise<void>;
  dismiss(): void;
  /** Flushes persisted visit starts and ends without blocking local resolution. */
  syncRemoteVisit(): Promise<void>;
  appStateChanged(status: AppStateStatus): void;
};

function visitRow(visit: CurrentVisit): NewVisit {
  return { localId: visit.localId, venueId: visit.venueId, venueName: visit.venueName, startedAt: visit.startedAt, remoteVisitId: visit.remoteVisitId };
}

export function createVenueController(): VenueController {
  let state: VenueState = initialVenueState;
  const listeners = new Set<() => void>();
  let inFlight: Promise<VenueContext> | undefined;
  let localUpdate = Promise.resolve();
  let confirmationId = 0;
  let selectionRevision = 0;

  async function syncRemoteVisit(): Promise<void> {
    try {
      await syncVisits();
      const localId = state.visit?.localId;
      const row = localId ? await getVisit(localId) : undefined;
      if (row?.remoteVisitId) dispatch({ type: 'remoteVisit', localId: row.localId, remoteVisitId: row.remoteVisitId });
    } catch (error) {
      console.warn('Could not sync visits with the server', error);
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

  async function closeVisit(visit: CurrentVisit, now: number): Promise<void> {
    await patchVisit(visit.localId, { endedAt: now });
    if ((await getSetting(CURRENT_VISIT_SETTING)) === visit.localId) await removeSetting(CURRENT_VISIT_SETTING);
    dispatch({ type: 'visitEnded', localId: visit.localId });
    void syncRemoteVisit();
  }

  function endVisit(visit: CurrentVisit, now: number): Promise<void> {
    return updateLocally(() => closeVisit(visit, now));
  }

  function ensureVisit(venue: SeededOption, now: number, wanted: () => boolean, chosen?: VenueOption): Promise<void> {
    return updateLocally(async () => {
      if (!wanted()) return;
      const current = state.visit;
      if (!current || current.venueId !== venue.venueId || !isVisitFresh(current, now)) {
        if (current) await closeVisit(current, now);
        if (!wanted()) return;
        const visit: CurrentVisit = { localId: randomUUID(), venueId: venue.venueId, venueName: venue.name, startedAt: now };
        await upsertVisit(visitRow(visit));
        if (!wanted()) {
          await closeVisit(visit, now);
          return;
        }
        await setSetting(CURRENT_VISIT_SETTING, visit.localId);
        if (!wanted()) {
          await closeVisit(visit, now);
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
    try {
      const places = await getPoiSearch().searchNearby(fix.lat, fix.lng, POI_RADIUS_M);
      dispatch({
        type: 'poiOptions',
        options: places.map((place) => ({
          kind: 'poi', name: place.name, lat: place.lat, lng: place.lng, distanceM: place.distanceMeters,
          category: place.category, ...(place.website ? { website: place.website } : {}),
        })),
      });
    } catch (error) {
      console.warn('Nearby place search failed', error);
    }
  }

  async function hydrate(): Promise<void> {
    const localId = await getSetting(CURRENT_VISIT_SETTING);
    const row = localId ? await getVisit(localId) : undefined;
    const now = Date.now();
    if (row && row.endedAt === null && isVisitFresh(row, now)) {
      dispatch({
        type: 'hydrated',
        visit: { localId: row.localId, venueId: row.venueId, venueName: row.venueName, startedAt: row.startedAt, remoteVisitId: row.remoteVisitId ?? undefined },
      });
      return;
    }
    if (row && row.endedAt === null) await endVisit({ ...row, remoteVisitId: row.remoteVisitId ?? undefined }, now);
    if (localId) await removeSetting(CURRENT_VISIT_SETTING);
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
      dispatch({ type: 'failed', error: errorMessage(error) });
      return venueContext(state);
    }
  }

  function resolve(): Promise<VenueContext> {
    inFlight ??= runResolve().finally(() => { inFlight = undefined; });
    return inFlight;
  }

  function resolveForScan(): Promise<VenueContext> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<VenueContext>((settle) => {
      timer = setTimeout(() => settle(venueContext(state)), SCAN_FIX_TIMEOUT_MS);
    });
    return Promise.race([resolve(), timeout]).finally(() => clearTimeout(timer));
  }

  async function confirm(option: VenueOption, signal?: AbortSignal): Promise<void> {
    const requestId = ++confirmationId;
    const wanted = () => requestId === confirmationId && !signal?.aborted;
    if (!wanted()) return;
    let venue: SeededOption;
    if (option.kind === 'seeded') {
      venue = option;
    } else {
      const fields = { name: option.name, lat: option.lat, lng: option.lng, ...(option.website ? { website: option.website } : {}) };
      const signed = await signPayload({ action: 'museums.confirmPoiVenue', ...fields });
      if (!wanted()) return;
      if (!signed) throw new Error('This device cannot confirm a new venue');
      const { venueId } = await convex.mutation(api.museums.confirmPoiVenue, { ...fields, ...signed });
      if (!wanted()) return;
      try {
        const db = await openVenueDb();
        if (!wanted()) return;
        await insertConfirmedVenue(db, { id: venueId, ...fields });
      } catch (error) {
        console.warn('Could not add the confirmed venue to the local table', error);
      }
      venue = { kind: 'seeded', venueId, name: option.name, distanceM: option.distanceM, ...(option.website ? { website: option.website } : {}) };
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

export function resolveVenueForScan(): Promise<VenueContext> {
  return venueController.resolveForScan();
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
  }, [controller]);

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
