import { useConvexAuth, useQuery } from "convex/react";
import { randomUUID } from "expo-crypto";
import * as Location from "expo-location";
import { useNetworkState } from "expo-network";
import { useRouter } from "expo-router";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { AppState, type AppStateStatus } from "react-native";

import { getSetting, removeSetting, setSetting } from "@/db/repos/settings";
import { findVisitOnDay, getVisit, patchVisit, upsertVisit } from "@/db/repos/visits";
import type { NewVisit, Visit } from "@/db/schema";
import { flushJournal } from "@/lib/account/collection-sync";
import { useIntroductionOver } from "@/lib/account/introduction";
import { captureOwner, getLocalOwner, subscribeOwnerChange, useLocalOwner } from "@/lib/account/owner-store";
import { signPayload } from "@/lib/attested-write";
import { convex } from "@/lib/convex-client";
import { prepareCaptureVisit } from "@/lib/journal/capture-visit";
import { museumDay } from "@/lib/journal/visit-date";
import { errorMessage, SyncUnavailableError } from "@/lib/network-error";
import { addBreadcrumb, reportError } from "@/lib/observability";
import { calendarDate } from "@/shared/journal/limits";
import { socialErrorMessage } from "@/shared/social/errors";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { getPoiSearch } from "../../../modules/poi-search/src";
import { refreshVenueTableInBackground } from "./refresh";
import { CHOOSE_RADIUS_M, pickVenue, type VenueRow } from "./resolve";
import { applyVenueMetadata, nearest, openVenueDb, venueCoordinates, venueNameById } from "./venue-db";
import {
  endedToday,
  initialVenueState,
  isVisitToday,
  needsFix,
  planSaveVisit,
  venueContext,
  venueReducer,
  type CurrentVisit,
  type Fix,
  type MuseumDay,
  type PoiOption,
  type SeededOption,
  type VenueContext,
  type VenueEvent,
  type VenueOption,
  type VenuePick,
  type VenueState,
} from "./venue-reducer";

export const CURRENT_VISIT_SETTING = "currentVisit";
/** The visit last ended, so a relaunch the same day does not start another at that museum. */
export const ENDED_VISIT_SETTING = "endedVisit";
/** MapKit search radius when nothing seeded is within 400 m; a Balanced fix is good to about 100 m. */
export const POI_RADIUS_M = 300;
/** A scan never waits longer than this for a fresh fix; it then goes out with the last known context. */
export const SCAN_FIX_TIMEOUT_MS = 3000;

export type VenueController = {
  subscribe: (listener: () => void) => () => void;
  getState: () => VenueState;
  getContext: () => VenueContext;
  /** Restores the open visit from the local store, whatever day it started; one from an earlier day starts paused. */
  hydrate: () => Promise<void>;
  /** One-shot fix and table lookup; reuses a fix younger than three minutes. Resolves the museum only, never a visit. */
  resolve: () => Promise<VenueContext>;
  /** The context a scan carries: a fresh resolution when it is quick, else the last known one, with the open visit when the phone is at its museum. */
  resolveForScan: (capturedAt: number) => Promise<VenueContext>;
  /** A tap in the sheet resolves that museum; MapKit places are confirmed on the server first. The visit starts with the first save. */
  confirm: (option: VenueOption, signal?: AbortSignal) => Promise<void>;
  dismiss: () => void;
  /** Swiping the location prompt away declines it like `dismiss`, unless a museum resolved while it was open. */
  declinePrompt: () => void;
  /** The only way a visit ends. Closes the open visit only while it is still `localId`; a stale end-visit review is a no-op. */
  end: (localId: string) => Promise<void>;
  /** Whether a save at this museum joins or starts its visit unless the person chooses otherwise; false for the rest of the day after "End visit" there. */
  visitByDefault: (venueId: Id<"museums">, at?: number) => boolean;
  /**
   * The visit a save at this museum links to, following `planSaveVisit`: the open visit, a visit on the books for the
   * capture's day stretched to cover the shutter, or a new one dated by the capture. Throws `VisitInProgressError` when
   * the save would start a visit while another is open.
   */
  visitForSave: (venueId: Id<"museums">, capturedAt: number) => Promise<CurrentVisit>;
  /** Flushes persisted visit starts and ends without blocking local resolution. */
  syncRemoteVisit: () => Promise<void>;
  appStateChanged: (status: AppStateStatus) => void;
};

function parseSetting<T>(value: string | undefined): T | undefined {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

async function venueDay(venueId: Id<"museums">, at: number): Promise<MuseumDay> {
  const coordinates = await venueCoordinates(venueId);
  if (!coordinates) throw new Error("The museum coordinates are not available");
  return museumDay(coordinates, at);
}

/**
 * Links a save to a visit already on the books for its museum and day, stretching the visit to cover the shutter.
 * Only the visit becoming current may stay `open`; a past one ends with its latest save.
 */
async function joinVisit(row: Visit, capturedAt: number, owner: string, open: boolean): Promise<CurrentVisit> {
  const startedAt = row.startedAt === null ? capturedAt : Math.min(row.startedAt, capturedAt);
  const latest = Math.max(row.startedAt ?? capturedAt, capturedAt);
  const endedAt = row.endedAt === null ? (open ? null : latest) : Math.max(row.endedAt, latest);
  const fields = {
    ...(startedAt !== row.startedAt ? { startedAt } : {}),
    ...(endedAt !== row.endedAt ? { endedAt } : {}),
  };
  if (Object.keys(fields).length > 0) await patchVisit(row.localId, fields, owner);
  return currentVisit({ ...row, startedAt });
}

/** A save would start a visit while another is open; only the person can end that one. */
export class VisitInProgressError extends Error {
  visit: CurrentVisit;
  constructor(visit: CurrentVisit) {
    super("Another visit is open");
    this.name = "VisitInProgressError";
    this.visit = visit;
  }
}

function visitRow(visit: CurrentVisit): NewVisit {
  return {
    localId: visit.localId,
    venueId: visit.venueId,
    venueName: visit.venueName,
    visibility: "private",
    startedAt: visit.startedAt,
    remoteVisitId: visit.remoteVisitId,
    timeZone: visit.timeZone,
    visitedOn: visit.visitedOn,
  };
}

function currentVisit(row: {
  localId: string;
  venueId: Id<"museums">;
  venueName: string;
  startedAt: number;
  visitedOn: string;
  timeZone: string;
  remoteVisitId: Id<"visits"> | null;
}): CurrentVisit {
  return {
    localId: row.localId,
    venueId: row.venueId,
    venueName: row.venueName,
    startedAt: row.startedAt,
    visitedOn: row.visitedOn,
    timeZone: row.timeZone,
    remoteVisitId: row.remoteVisitId ?? undefined,
  };
}

/**
 * Creates the museum on the server for a MapKit place and adds it to the local table. Returns undefined once
 * `wanted` says the caller moved on; the server row still exists and is harmless.
 */
export async function confirmPlace(
  option: PoiOption,
  wanted: () => boolean = () => true,
): Promise<VenueRow | undefined> {
  const fields = {
    city: option.city,
    country: option.country,
    name: option.name,
    lat: option.lat,
    lng: option.lng,
    ...(option.website ? { website: option.website } : {}),
  };
  const signed = await signPayload({
    action: "museums.confirmPoiVenue",
    ...fields,
  });
  if (!wanted()) return undefined;
  if (!signed) throw new Error("This device cannot confirm a new venue");
  const { venue } = await convex.mutation(api.museums.confirmPoiVenue, {
    ...fields,
    ...signed,
  });
  if (!wanted()) return undefined;
  try {
    const db = await openVenueDb();
    if (!wanted()) return undefined;
    await applyVenueMetadata(db, [venue]);
  } catch (error) {
    reportError(error, "venue.confirm.persist");
    console.warn("Could not add the confirmed venue to the local table", error);
  }
  return {
    id: venue.id,
    key: venue.key,
    name: venue.name,
    lat: venue.lat,
    lng: venue.lng,
    website: venue.website ?? null,
    region: venue.region,
    city: venue.city ?? null,
    cityKey: venue.cityKey ?? null,
    country: venue.country ?? null,
  };
}

export function createVenueController(): VenueController {
  let state: VenueState = initialVenueState;
  const listeners = new Set<() => void>();
  let inFlight: Promise<VenueContext> | undefined;
  let localUpdate = Promise.resolve();
  let confirmationId = 0;
  let selectionRevision = 0;
  subscribeOwnerChange(() => {
    confirmationId++;
    selectionRevision++;
    state = initialVenueState;
    for (const listener of listeners) listener();
  });
  const currentVisitKey = (owner = getLocalOwner()) => `${CURRENT_VISIT_SETTING}:${owner}`;
  const manualVisitKey = (owner = getLocalOwner()) => `manualVisit:${owner}`;
  const endedVisitKey = (owner = getLocalOwner()) => `${ENDED_VISIT_SETTING}:${owner}`;
  const pickedKey = (owner: string) => `venuePick:${owner}`;
  const notHereKey = (owner: string) => `notHere:${owner}`;

  /** Keeps the sheet's answers across relaunches; the state already holds them, so a failed write only costs that. */
  async function saveAnswers(
    owner: string,
    { picked, notHere }: Pick<VenueState, "picked" | "notHere">,
  ): Promise<void> {
    try {
      await setSetting(notHereKey(owner), JSON.stringify(notHere));
      if (picked) await setSetting(pickedKey(owner), JSON.stringify(picked));
      else await removeSetting(pickedKey(owner));
    } catch (error) {
      reportError(error, "venue.answers.save");
      console.warn("Could not save the museum answer", error);
    }
  }

  async function syncRemoteVisit(): Promise<void> {
    const current = captureOwner();
    try {
      await flushJournal();
      if (!current.isCurrent()) return;
      const localId = state.visit?.localId;
      const row = localId ? await getVisit(localId) : undefined;
      if (row?.remoteVisitId) {
        dispatch({
          type: "remoteVisit",
          localId: row.localId,
          remoteVisitId: row.remoteVisitId,
        });
      }
    } catch (error) {
      reportError(error, "venue.visit.sync");
      if (!(error instanceof SyncUnavailableError)) {
        console.warn("Could not sync visits with the server", error);
      }
    }
  }

  function updateLocally<T>(task: () => Promise<T>): Promise<T> {
    const next = localUpdate.then(task);
    localUpdate = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  function dispatch(event: VenueEvent): void {
    const next = venueReducer(state, event);
    if (next === state) return;
    state = next;
    for (const listener of listeners) listener();
  }

  async function closeVisit(visit: CurrentVisit, now: number, owner: string): Promise<void> {
    await patchVisit(visit.localId, { endedAt: now }, owner);
    if ((await getSetting(currentVisitKey(owner))) === visit.localId) {
      await removeSetting(currentVisitKey(owner));
    }
    if ((await getSetting(manualVisitKey(owner))) === visit.localId) {
      await removeSetting(manualVisitKey(owner));
    }
    await setSetting(endedVisitKey(owner), visit.localId);
    if (owner !== getLocalOwner()) return;
    dispatch({ type: "visitEnded", localId: visit.localId, at: now });
    void syncRemoteVisit();
  }

  function visitByDefault(venueId: Id<"museums">, at = Date.now()): boolean {
    return !endedToday(state, venueId, at);
  }

  function visitForSave(venueId: Id<"museums">, capturedAt: number): Promise<CurrentVisit> {
    const ownership = captureOwner();
    const { owner } = ownership;
    const checkOwner = () => {
      if (!ownership.isCurrent()) throw new Error("Journal owner changed");
    };
    return updateLocally(async () => {
      checkOwner();
      const current = state.visit;
      const day =
        current?.venueId === venueId
          ? { visitedOn: calendarDate(capturedAt, current.timeZone), timeZone: current.timeZone }
          : await venueDay(venueId, capturedAt);
      checkOwner();
      const plan = planSaveVisit(current, venueId, { ...day, at: capturedAt }, Date.now());
      if (current && plan === "endFirst") throw new VisitInProgressError(current);
      if (current && plan === "join") {
        if (capturedAt >= current.startedAt) return current;
        // The capture waited for its save: the visit began with this shutter.
        await patchVisit(current.localId, { startedAt: capturedAt }, owner);
        checkOwner();
        const backdated = { ...current, startedAt: capturedAt };
        if (state.visit?.localId === current.localId) {
          dispatch({ type: "visitStarted", visit: backdated });
        }
        return backdated;
      }
      const opens = plan === "start";
      // A starting visit never reopens one ended today; a past one joins the day's visit.
      const existing = await findVisitOnDay(venueId, day.visitedOn, owner, {
        open: opens,
      });
      checkOwner();
      let visit: CurrentVisit;
      if (existing) {
        visit = await joinVisit(existing, capturedAt, owner, opens);
      } else {
        const name = state.venue?.venueId === venueId ? state.venue.name : await venueNameById(venueId);
        checkOwner();
        if (!name) throw new Error("The museum is not available");
        visit = {
          localId: randomUUID(),
          venueId,
          venueName: name,
          startedAt: capturedAt,
          ...day,
        };
        // A past visit was never open: it spans exactly the saves it gets.
        await upsertVisit({ ...visitRow(visit), ...(opens ? {} : { endedAt: capturedAt }) }, owner);
      }
      checkOwner();
      if (opens) {
        await removeSetting(endedVisitKey(owner));
        if (state.venue?.venueId === venueId && state.venue.manual) {
          visit = { ...visit, manual: true };
          await setSetting(manualVisitKey(owner), visit.localId);
        }
        await setSetting(currentVisitKey(owner), visit.localId);
        if (ownership.isCurrent()) {
          const { picked } = state;
          dispatch({ type: "visitStarted", visit });
          // A visit starting elsewhere drops the pick from the list; a relaunch must not restore it.
          if (state.picked !== picked) await saveAnswers(owner, state);
        }
      }
      void syncRemoteVisit();
      return visit;
    });
  }

  async function searchNearbyPlaces(fix: { lat: number; lng: number }, quiet: boolean): Promise<void> {
    const ownership = captureOwner();
    try {
      const places = await getPoiSearch().searchNearby(fix.lat, fix.lng, POI_RADIUS_M);
      if (!ownership.isCurrent()) return;
      dispatch({
        type: "poiOptions",
        quiet,
        options: places.map((place) => ({
          kind: "poi",
          name: place.name,
          lat: place.lat,
          lng: place.lng,
          distanceM: place.distanceMeters,
          category: place.category,
          city: place.city,
          country: place.country,
          ...(place.website ? { website: place.website } : {}),
        })),
      });
    } catch (error) {
      reportError(error, "venue.search.nearby", { level: "warning" });
      console.warn("Nearby place search failed", error);
    }
  }

  async function hydrate(): Promise<void> {
    const ownership = captureOwner();
    const { owner } = ownership;
    const localId = await getSetting(currentVisitKey(owner));
    const row = localId ? await getVisit(localId, owner) : undefined;
    const endedId = await getSetting(endedVisitKey(owner));
    const endedRow = endedId ? await getVisit(endedId, owner) : undefined;
    const answers = {
      picked: parseSetting<VenuePick>(await getSetting(pickedKey(owner))),
      notHere: parseSetting<VenueState["notHere"]>(await getSetting(notHereKey(owner))),
    };
    if (!ownership.isCurrent()) return;
    const now = Date.now();
    const endedOn = endedRow?.endedAt != null && {
      venueId: endedRow.venueId,
      visitedOn: calendarDate(endedRow.endedAt, endedRow.timeZone),
      timeZone: endedRow.timeZone,
    };
    const ended = endedOn && isVisitToday(endedOn, now) ? endedOn : undefined;
    if (endedId && !ended) await removeSetting(endedVisitKey(owner));
    if (row && row.startedAt !== null && row.endedAt === null) {
      const manual = (await getSetting(manualVisitKey(owner))) === row.localId;
      if (!ownership.isCurrent()) return;
      dispatch({
        type: "hydrated",
        at: now,
        visit: {
          ...currentVisit({ ...row, startedAt: row.startedAt }),
          manual,
        },
        ...answers,
      });
    } else {
      if (localId) await removeSetting(currentVisitKey(owner));
      dispatch({ type: "hydrated", at: now, ended, ...answers });
    }
  }

  // A scan resolves quietly (no sheet) and is the only resolve that may raise the system location prompt: launch and
  // foreground resolves keep whatever the person chose on the welcome's Access page or in the museum sheet.
  async function runResolve(forScan: boolean): Promise<VenueContext> {
    void syncRemoteVisit();
    // A museum picked by hand stands for the rest of its day there, visit or not; location takes over again the next day.
    if (state.venue?.manual && isVisitToday(state.venue.manual, Date.now())) {
      return venueContext(state);
    }
    if (!needsFix(state, Date.now())) return venueContext(state);
    const revision = selectionRevision;
    const wanted = () => revision === selectionRevision;
    dispatch({ type: "locating" });
    try {
      const permission = await (forScan
        ? Location.requestForegroundPermissionsAsync()
        : Location.getForegroundPermissionsAsync());
      if (!wanted()) return venueContext(state);
      if (!permission.granted) {
        dispatch({ type: "denied", at: Date.now() });
        return venueContext(state);
      }
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      if (!wanted()) return venueContext(state);
      const fix = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        at: Date.now(),
      };
      const resolution = pickVenue(await nearest(await openVenueDb(), fix, CHOOSE_RADIUS_M));
      if (!wanted()) return venueContext(state);
      if (__DEV__) {
        console.debug(
          "Venue resolved",
          resolution.kind,
          resolution.kind === "none"
            ? ""
            : resolution.options.map((row) => `${row.name} ${Math.round(row.distanceM)} m`),
        );
      }
      dispatch({ type: "resolved", fix, resolution, quiet: forScan });
      addBreadcrumb("venue.resolved", { kind: resolution.kind });
      if (state.status === "none" && resolution.kind === "none") {
        await searchNearbyPlaces(fix, forScan);
      }
      return venueContext(state);
    } catch (error) {
      if (!wanted()) return venueContext(state);
      reportError(error, "venue.resolve", { level: "warning" });
      console.warn("Venue resolution failed", error);
      dispatch({
        type: "failed",
        error: socialErrorMessage(error) ?? errorMessage(error),
      });
      return venueContext(state);
    }
  }

  function startResolve(forScan: boolean): Promise<VenueContext> {
    inFlight ??= runResolve(forScan).finally(() => {
      inFlight = undefined;
    });
    return inFlight;
  }

  function resolve(): Promise<VenueContext> {
    return startResolve(false);
  }

  async function resolveForScan(capturedAt: number): Promise<VenueContext> {
    const ownership = captureOwner();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<VenueContext>((settle) => {
      timer = setTimeout(() => settle(venueContext(state)), SCAN_FIX_TIMEOUT_MS);
    });
    const context = await Promise.race([startResolve(true), timeout]).finally(() => clearTimeout(timer));
    if (!ownership.isCurrent()) throw new Error("Journal owner changed");
    return prepareCaptureVisit(context, capturedAt);
  }

  async function confirm(option: VenueOption, signal?: AbortSignal): Promise<void> {
    const ownership = captureOwner();
    const requestId = ++confirmationId;
    const wanted = () => ownership.isCurrent() && requestId === confirmationId && !signal?.aborted;
    if (!wanted()) return;
    let venue: SeededOption;
    let day: MuseumDay;
    if (option.kind === "seeded") {
      venue = option;
      day = option.manual ?? (await venueDay(option.venueId, Date.now()));
    } else {
      const row = await confirmPlace(option, wanted);
      if (!row) return;
      day = museumDay(row, Date.now());
      venue = {
        kind: "seeded",
        venueId: row.id,
        name: row.name,
        ...(option.distanceM === undefined ? {} : { distanceM: option.distanceM }),
        ...(row.website ? { website: row.website } : {}),
      };
    }
    await updateLocally(async () => {
      if (!wanted()) return;
      if (state.ended?.venueId === venue.venueId) {
        await removeSetting(endedVisitKey(ownership.owner));
      }
      if (!wanted()) return;
      if (venue.manual && state.visit?.venueId === venue.venueId) {
        await setSetting(manualVisitKey(ownership.owner), state.visit.localId);
        if (!wanted()) return;
      }
      selectionRevision++;
      dispatch({ type: "chosen", option: venue, replaces: option, day });
      await saveAnswers(ownership.owner, state);
    });
  }

  function dismiss(): void {
    confirmationId++;
    const owner = getLocalOwner();
    dispatch({ type: "dismissed", at: Date.now() });
    const answers = { picked: state.picked, notHere: state.notHere };
    void updateLocally(() => saveAnswers(owner, answers));
  }

  function declinePrompt(): void {
    if (!state.venue) dismiss();
  }

  async function end(localId: string): Promise<void> {
    const { visit } = state;
    if (!visit || visit.localId !== localId) return;
    const owner = getLocalOwner();
    await updateLocally(() => closeVisit(visit, Date.now(), owner));
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getState: () => state,
    getContext: () => venueContext(state),
    hydrate,
    resolve,
    resolveForScan,
    confirm,
    dismiss,
    declinePrompt,
    end,
    visitByDefault,
    visitForSave,
    syncRemoteVisit,
    appStateChanged(status) {
      if (status === "background") dispatch({ type: "backgrounded" });
      else if (status === "active") void resolve();
    },
  };
}

export const venueController = createVenueController();

export function resolveVenueForScan(capturedAt: number): Promise<VenueContext> {
  return venueController.resolveForScan(capturedAt);
}

export function visitByDefault(venueId: Id<"museums">, at?: number): boolean {
  return venueController.visitByDefault(venueId, at);
}

export function visitForSave(venueId: Id<"museums">, capturedAt: number): Promise<CurrentVisit> {
  return venueController.visitForSave(venueId, capturedAt);
}

export type VenueView = {
  status: VenueState["status"];
  venue?: SeededOption;
  /** The open visit, at the resolved venue or paused while the phone is away from it. */
  visit?: CurrentVisit;
  visitId?: VenueContext["visitId"];
  options: VenueOption[];
  /** The last location fix, for searches that should look near the phone. */
  fix?: Fix;
  error?: string;
  resolve: VenueController["resolve"];
  confirm: VenueController["confirm"];
  dismiss: VenueController["dismiss"];
  declinePrompt: VenueController["declinePrompt"];
  end: VenueController["end"];
};

export function useVenue(controller: VenueController = venueController): VenueView {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  return {
    status: snapshot.status,
    venue: snapshot.venue,
    visit: snapshot.visit,
    visitId: venueContext(snapshot).visitId,
    options: snapshot.options,
    fix: snapshot.fix,
    error: snapshot.error,
    resolve: controller.resolve,
    confirm: controller.confirm,
    dismiss: controller.dismiss,
    declinePrompt: controller.declinePrompt,
    end: controller.end,
  };
}

/** Mounted once under the database gate: resolves on launch and foreground, opens the sheet, syncs the visit. */
export function VenueResolver({ controller = venueController }: { controller?: VenueController }): null {
  const owner = useLocalOwner();
  const router = useRouter();
  const { isAuthenticated } = useConvexAuth();
  const device = useQuery(api.devices.me, isAuthenticated ? {} : "skip");
  const { isInternetReachable } = useNetworkState();
  const prompt = useSyncExternalStore(
    controller.subscribe,
    () => controller.getState().prompt,
    () => controller.getState().prompt,
  );
  const seenPrompt = useRef(prompt);
  const introduced = useIntroductionOver(owner);

  useEffect(() => {
    // The location request and the museum sheet would otherwise land on top of a first launch's welcome.
    if (!introduced) return;
    void controller
      .hydrate()
      .then(controller.resolve)
      .catch((error: unknown) => {
        reportError(error, "venue.visit.restore");
        console.warn("Could not restore the visit", error);
      });
    refreshVenueTableInBackground();
    const subscription = AppState.addEventListener("change", controller.appStateChanged);
    return () => subscription.remove();
  }, [controller, owner, introduced]);

  useEffect(() => {
    if (device && isInternetReachable !== false) {
      void controller.syncRemoteVisit();
    }
  }, [controller, device, isInternetReachable]);

  useEffect(() => {
    if (prompt === seenPrompt.current) return;
    seenPrompt.current = prompt;
    // The prompt asks where the phone is now, so the sheet lists the candidates even while a visit is paused elsewhere.
    router.push({ pathname: "/venue-picker", params: { mode: "choose" } });
  }, [prompt, router]);

  return null;
}
