import { useConvexAuth, useQuery } from "convex/react";
import { randomUUID } from "expo-crypto";
import * as Location from "expo-location";
import { useNetworkState } from "expo-network";
import { useRouter } from "expo-router";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { AppState, type AppStateStatus } from "react-native";

import { activateVisit, visitSettingKeys } from "@/db/repos/current-visit";
import { getSetting, removeSetting, setSetting } from "@/db/repos/settings";
import {
  discardVisit,
  findVisitOnDay,
  getVisit,
  latestVisitSaveAt,
  moveVisit,
  patchVisit,
  upsertVisit,
} from "@/db/repos/visits";
import type { NewVisit, Visit } from "@/db/schema";
import { flushJournal } from "@/lib/account/collection-sync";
import { useIntroduction } from "@/lib/account/introduction";
import { captureOwner, getLocalOwner, subscribeOwnerChange, useLocalOwner } from "@/lib/account/owner-store";
import { signPayload } from "@/lib/attested-write";
import { convex } from "@/lib/convex-client";
import { prepareCaptureVisit } from "@/lib/journal/capture-visit";
import { museumDay } from "@/lib/journal/visit-date";
import { clearWrapUp, markWrapUp } from "@/lib/journal/wrap-up";
import { SyncUnavailableError } from "@/lib/network-error";
import { isOffline } from "@/lib/network-state";
import { addBreadcrumb, reportError } from "@/lib/observability";
import { calendarDate } from "@/shared/journal/limits";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { getPoiSearch } from "../../../modules/poi-search/src";
import { refreshVenueTableInBackground } from "./refresh";
import { CHOOSE_RADIUS_M, pickVenue, type VenueRow } from "./resolve";
import {
  applyVenueMetadata,
  filterExcludedPlaces,
  nearest,
  openVenueDb,
  venueCoordinates,
  venueNameById,
} from "./venue-db";
import {
  endedToday,
  initialVenueState,
  isVisitToday,
  needsFix,
  planSaveVisit,
  venueContext,
  venueReducer,
  visitReady,
  type CurrentVisit,
  type Fix,
  type MuseumDay,
  type PoiOption,
  type SeededOption,
  type VenueContext,
  type VenueEvent,
  type VenueFailure,
  type VenueOption,
  type VenuePick,
  type VenueState,
  type VisitReady,
} from "./venue-reducer";

/** MapKit search radius when nothing seeded is within 400 m; a Balanced fix is good to about 100 m. */
export const POI_RADIUS_M = 300;
/** A scan never waits longer than this for a fresh fix; it then goes out with the last known context. */
export const SCAN_FIX_TIMEOUT_MS = 3000;

/**
 * Where a resolve left the phone: a fix younger than three minutes, why there is none, or undefined when a museum chosen
 * meanwhile superseded the fix.
 */
export type Located = { fix: Fix } | { failure: LocationFailure } | undefined;
/** Location access is off, or on but the phone could not be located. */
export type LocationFailure = "denied" | "unavailable";

type StartVisitOptions = {
  signal?: AbortSignal;
  replaceVisitLocalId?: string;
};

type SaveVisitOptions = StartVisitOptions & {
  /** For saves filed after the fact: one that would start a visit joins or logs the museum day's visit instead. */
  past?: boolean;
};

export type VenueController = {
  subscribe: (listener: () => void) => () => void;
  getState: () => VenueState;
  getContext: () => VenueContext;
  /** Restores the open visit from the local store; one left open past its museum day is closed first and queued for a wrap-up. */
  hydrate: () => Promise<void>;
  /**
   * One-shot fix and table lookup; reuses a fix younger than three minutes. Resolves the museum only, never a visit,
   * and never opens the sheet: an undecided spot waits for the camera, the Now card or the venue pill to ask. Answers
   * where the phone is for a tap on My location.
   */
  resolve: () => Promise<Located>;
  /** The context a scan carries: a fresh resolution when it is quick, else the last known one, with the open visit when the phone is at its museum. */
  resolveForScan: (capturedAt: number) => Promise<VenueContext>;
  /**
   * A tap in the sheet resolves that museum; MapKit places are confirmed on the server first. Resolves to the museum's
   * id, or undefined when superseded. Only the location prompt also starts a visit; elsewhere it starts with the first save.
   */
  confirm: (option: VenueOption, signal?: AbortSignal) => Promise<Id<"museums"> | undefined>;
  dismiss: () => void;
  /** Swiping the location prompt away declines it like `dismiss`, unless a museum resolved while it was open. */
  declinePrompt: () => void;
  /** Opens the museum sheet when the camera comes up at a spot still undecided between seeded museums. */
  promptChooser: () => void;
  /** Ends the open visit by hand. Closes it only while it is still `localId`; a stale end-visit review is a no-op. */
  end: (localId: string) => Promise<void>;
  /** Discards a visit; the open one ends first, so saves at its museum start no visit by themselves for the rest of the day. */
  discard: (localId: string) => Promise<void>;
  /** Opens today's visit without a save; a prompt may replace the named open visit. Cancellation is honored until commit. */
  startVisit: (venueId: Id<"museums">, options?: StartVisitOptions) => Promise<CurrentVisit>;
  /** Moves a visit to another museum or day; the open visit carries the change into the venue state. */
  move: (localId: string, to: Pick<Visit, "venueId" | "venueName" | "visitedOn" | "timeZone">) => Promise<void>;
  /** Whether a save at this museum joins or starts its visit unless the person chooses otherwise; false for the rest of the day after "End visit" there. */
  visitByDefault: (venueId: Id<"museums">, at?: number) => boolean;
  /**
   * The visit a save at this museum links to, following `planSaveVisit`: the open visit, a visit on the books for the
   * capture's day stretched to cover the shutter, or a new one dated by the capture. Throws `VisitInProgressError` when
   * the save would start a visit while another is open.
   */
  visitForSave: (venueId: Id<"museums">, capturedAt: number, options?: SaveVisitOptions) => Promise<CurrentVisit>;
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

/** A past visit spans its saves, even when it was originally logged without start and end times. */
async function joinVisit(row: Visit, capturedAt: number, owner: string): Promise<CurrentVisit> {
  const startedAt = row.startedAt === null ? capturedAt : Math.min(row.startedAt, capturedAt);
  const latest = Math.max(row.startedAt ?? capturedAt, capturedAt);
  const endedAt = row.endedAt === null ? latest : Math.max(row.endedAt, latest);
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

function visitRow(visit: CurrentVisit): NewVisit & { startedAt: number } {
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
  let inFlight: Promise<Located> | undefined;
  let localUpdate = Promise.resolve();
  let confirmationId = 0;
  let selectionRevision = 0;
  subscribeOwnerChange(() => {
    confirmationId++;
    selectionRevision++;
    state = initialVenueState;
    for (const listener of listeners) listener();
  });
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
      await updateLocally(() => refreshOpenVisit(current));
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

  async function refreshOpenVisit(ownership: ReturnType<typeof captureOwner>): Promise<void> {
    const open = state.visit;
    if (!ownership.isCurrent() || !open) return;
    const row = await getVisit(open.localId, ownership.owner, { discarded: true });
    if (!ownership.isCurrent() || state.visit?.localId !== open.localId || !row || row.startedAt === null) return;
    if (row.endedAt !== null || row.deletedAt !== null) {
      dispatch({ type: "visitEnded", localId: row.localId, at: row.endedAt ?? row.deletedAt! });
    } else {
      const selected = state.venue;
      dispatch({
        type: "visitStarted",
        visit: { ...currentVisit({ ...row, startedAt: row.startedAt }), manual: open.manual },
      });
      if (row.venueId !== open.venueId && selected?.manual && selected.venueId === open.venueId) {
        const day = { visitedOn: calendarDate(Date.now(), row.timeZone), timeZone: row.timeZone };
        selectionRevision++;
        dispatch({
          type: "chosen",
          option: { kind: "seeded", venueId: row.venueId, name: row.venueName, manual: day },
          replaces: selected,
          day,
        });
        await saveAnswers(ownership.owner, state);
      }
    }
  }

  async function closeVisit(visit: CurrentVisit, now: number, owner: string): Promise<void> {
    await patchVisit(visit.localId, { endedAt: now }, owner);
    if ((await getSetting(visitSettingKeys(owner).current)) === visit.localId) {
      await removeSetting(visitSettingKeys(owner).current);
    }
    if ((await getSetting(visitSettingKeys(owner).manual)) === visit.localId) {
      await removeSetting(visitSettingKeys(owner).manual);
    }
    await setSetting(visitSettingKeys(owner).ended, visit.localId);
    if (owner !== getLocalOwner()) return;
    dispatch({ type: "visitEnded", localId: visit.localId, at: now });
    void syncRemoteVisit();
  }

  /** A visit left open past its museum day ends where its saves stopped and waits on Home for a review. */
  async function endExpiredVisit(ownership: ReturnType<typeof captureOwner>): Promise<void> {
    const open = state.visit;
    if (!open || !ownership.isCurrent() || isVisitToday(open, Date.now())) return;
    const latest = await latestVisitSaveAt(open.localId, ownership.owner);
    if (!ownership.isCurrent() || state.visit?.localId !== open.localId) return;
    await closeVisit(open, Math.max(open.startedAt, latest ?? open.startedAt), ownership.owner);
    await markWrapUp(ownership.owner, open.localId);
  }

  function visitByDefault(venueId: Id<"museums">, at = Date.now()): boolean {
    return !endedToday(state, venueId, at);
  }

  function visitForSave(
    venueId: Id<"museums">,
    capturedAt: number,
    { signal, replaceVisitLocalId, past = false }: SaveVisitOptions = {},
  ): Promise<CurrentVisit> {
    const ownership = captureOwner();
    const { owner } = ownership;
    const checkOwner = () => {
      if (signal?.aborted) throw Object.assign(new Error("Visit start cancelled"), { name: "AbortError" });
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
      const proposed = planSaveVisit(current, venueId, { ...day, at: capturedAt }, Date.now());
      const replacing = proposed === "endFirst" && current?.localId === replaceVisitLocalId;
      const plan = replacing ? "start" : past && proposed !== "join" ? "past" : proposed;
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
        visit = opens
          ? currentVisit({ ...existing, startedAt: Math.min(existing.startedAt ?? capturedAt, capturedAt) })
          : await joinVisit(existing, capturedAt, owner);
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
        if (!opens) await upsertVisit({ ...visitRow(visit), endedAt: capturedAt }, owner);
      }
      checkOwner();
      if (opens) {
        if (state.venue?.venueId === venueId && state.venue.manual) visit = { ...visit, manual: true };
        activateVisit(visitRow(visit), owner, {
          manual: visit.manual,
          endPrevious: replacing && current ? { localId: current.localId, at: capturedAt } : undefined,
        });
        const { picked } = state;
        dispatch({ type: "visitStarted", visit });
        // A visit starting elsewhere drops the pick from the list; a relaunch must not restore it.
        if (state.picked !== picked) await saveAnswers(owner, state);
      }
      void syncRemoteVisit();
      return visit;
    });
  }

  async function searchNearbyPlaces(fix: { lat: number; lng: number }): Promise<void> {
    const ownership = captureOwner();
    try {
      const places = await getPoiSearch().searchNearby(fix.lat, fix.lng, POI_RADIUS_M);
      if (!ownership.isCurrent()) return;
      const available = await filterExcludedPlaces(await openVenueDb(), places);
      if (!ownership.isCurrent()) return;
      dispatch({
        type: "poiOptions",
        options: available.map((place) => ({
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
    const localId = await getSetting(visitSettingKeys(owner).current);
    const row = localId ? await getVisit(localId, owner) : undefined;
    const endedId = await getSetting(visitSettingKeys(owner).ended);
    const endedRow = endedId ? await getVisit(endedId, owner, { discarded: true }) : undefined;
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
    if (endedId && !ended) await removeSetting(visitSettingKeys(owner).ended);
    if (row && row.startedAt !== null && row.endedAt === null) {
      const manual = (await getSetting(visitSettingKeys(owner).manual)) === row.localId;
      if (!ownership.isCurrent()) return;
      const visit = { ...currentVisit({ ...row, startedAt: row.startedAt }), manual };
      if (!isVisitToday(visit, now)) {
        // The visit outlived its museum day while the app was closed: it ends where its saves stopped and waits for a review.
        const latest = await latestVisitSaveAt(row.localId, owner);
        if (!ownership.isCurrent()) return;
        await closeVisit(visit, Math.max(row.startedAt, latest ?? row.startedAt), owner);
        await markWrapUp(owner, row.localId);
        if (!ownership.isCurrent()) return;
        dispatch({ type: "hydrated", at: now, ...answers });
        return;
      }
      dispatch({ type: "hydrated", at: now, visit, ...answers });
    } else {
      if (localId) await removeSetting(visitSettingKeys(owner).current);
      dispatch({ type: "hydrated", at: now, ended, ...answers });
    }
  }

  // A scan is the only resolve that may raise the system location prompt: launch and foreground resolves keep whatever
  // the person chose on the welcome's Access page or in the museum sheet.
  async function runResolve(forScan: boolean): Promise<Located> {
    void syncRemoteVisit();
    // Coming back to the app on a later day closes yesterday's visit before the fix decides where the phone is now.
    await updateLocally(() => endExpiredVisit(captureOwner())).catch((error: unknown) => {
      reportError(error, "venue.visit.expire");
      console.warn("Could not close the visit from an earlier day", error);
    });
    const recentFix = (): Located => (state.fix && !needsFix(state, Date.now()) ? { fix: state.fix } : undefined);
    // Scans keep a manual museum without waiting for GPS; other resolves can refresh Explore's location too.
    if (forScan && state.venue?.manual && isVisitToday(state.venue.manual, Date.now())) {
      return recentFix();
    }
    if (!needsFix(state, Date.now())) return recentFix();
    const revision = selectionRevision;
    const wanted = () => revision === selectionRevision;
    dispatch({ type: "locating" });
    let fix: Fix | undefined;
    try {
      const permission = await (forScan
        ? Location.requestForegroundPermissionsAsync()
        : Location.getForegroundPermissionsAsync());
      if (!wanted()) return recentFix();
      if (!permission.granted) {
        dispatch({ type: "denied", at: Date.now() });
        return { failure: "denied" };
      }
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      if (!wanted()) return recentFix();
      fix = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        at: Date.now(),
      };
      const resolution = pickVenue(await nearest(await openVenueDb(), fix, CHOOSE_RADIUS_M));
      if (!wanted()) return recentFix();
      if (__DEV__) {
        console.debug(
          "Venue resolved",
          resolution.kind,
          resolution.kind === "none"
            ? ""
            : resolution.options.map((row) => `${row.name} ${Math.round(row.distanceM)} m`),
        );
      }
      dispatch({ type: "resolved", fix, resolution });
      addBreadcrumb("venue.resolved", { kind: resolution.kind });
      if (state.status === "none" && resolution.kind === "none") {
        await searchNearbyPlaces(fix);
      }
      return { fix };
    } catch (error) {
      if (!wanted()) return recentFix();
      reportError(error, "venue.resolve", { level: "warning" });
      console.warn("Venue resolution failed", error);
      dispatch({ type: "failed", error: fix ? "lookup" : "location" });
      return fix ? { fix } : { failure: "unavailable" };
    }
  }

  function startResolve(forScan: boolean): Promise<Located> {
    inFlight ??= runResolve(forScan).finally(() => {
      inFlight = undefined;
    });
    return inFlight;
  }

  function resolve(): Promise<Located> {
    return startResolve(false);
  }

  async function resolveForScan(capturedAt: number): Promise<VenueContext> {
    const ownership = captureOwner();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((settle) => {
      timer = setTimeout(settle, SCAN_FIX_TIMEOUT_MS);
    });
    await Promise.race([startResolve(true), timeout]).finally(() => clearTimeout(timer));
    await updateLocally(() => refreshOpenVisit(ownership));
    if (!ownership.isCurrent()) throw new Error("Journal owner changed");
    return prepareCaptureVisit(venueContext(state), capturedAt);
  }

  async function confirm(option: VenueOption, signal?: AbortSignal): Promise<Id<"museums"> | undefined> {
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
        ...(option.manual ? { manual: day } : {}),
      };
    }
    return updateLocally(async () => {
      if (!wanted()) return;
      if (state.ended?.venueId === venue.venueId) {
        await removeSetting(visitSettingKeys(ownership.owner).ended);
      }
      if (!wanted()) return;
      if (venue.manual && state.visit?.venueId === venue.venueId) {
        await setSetting(visitSettingKeys(ownership.owner).manual, state.visit.localId);
        if (!wanted()) return;
      }
      selectionRevision++;
      dispatch({ type: "chosen", option: venue, replaces: option, day });
      await saveAnswers(ownership.owner, state);
      return wanted() ? venue.venueId : undefined;
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

  function promptChooser(): void {
    dispatch({ type: "prompt", at: Date.now() });
  }

  function startVisit(venueId: Id<"museums">, options?: StartVisitOptions): Promise<CurrentVisit> {
    return visitForSave(venueId, Date.now(), options);
  }

  async function end(localId: string): Promise<void> {
    const { visit } = state;
    if (!visit || visit.localId !== localId) return;
    const owner = getLocalOwner();
    await updateLocally(() => closeVisit(visit, Date.now(), owner));
  }

  function discard(localId: string): Promise<void> {
    const ownership = captureOwner();
    return updateLocally(async () => {
      const { visit } = state;
      if (visit?.localId === localId && ownership.isCurrent()) await closeVisit(visit, Date.now(), ownership.owner);
      discardVisit(localId, ownership.owner);
      await clearWrapUp(ownership.owner, localId);
    });
  }

  function move(localId: string, to: Pick<Visit, "venueId" | "venueName" | "visitedOn" | "timeZone">): Promise<void> {
    const ownership = captureOwner();
    return updateLocally(async () => {
      await moveVisit(localId, to, ownership.owner);
      await refreshOpenVisit(ownership);
    });
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
    promptChooser,
    end,
    discard,
    startVisit,
    move,
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

export function visitForSave(
  venueId: Id<"museums">,
  capturedAt: number,
  options?: SaveVisitOptions,
): Promise<CurrentVisit> {
  return venueController.visitForSave(venueId, capturedAt, options);
}

/** The open visit's id right now, so a save can tell whether it started that visit or joined it. */
export function openVisitLocalId(): string | undefined {
  return venueController.getState().visit?.localId;
}

export type VenueView = {
  hydrated: boolean;
  status: VenueState["status"];
  venue?: SeededOption;
  /** The open visit, at the resolved venue or paused while the phone is away from it. */
  visit?: CurrentVisit;
  /** Where Start visit applies while no visit is open. */
  ready?: VisitReady;
  visitId?: VenueContext["visitId"];
  options: VenueOption[];
  /** The last location fix, for searches that should look near the phone. */
  fix?: Fix;
  failure?: VenueFailure;
  resolve: VenueController["resolve"];
  confirm: VenueController["confirm"];
  dismiss: VenueController["dismiss"];
  declinePrompt: VenueController["declinePrompt"];
  promptChooser: VenueController["promptChooser"];
  end: VenueController["end"];
  discard: VenueController["discard"];
  startVisit: VenueController["startVisit"];
  move: VenueController["move"];
};

export function useVenue(controller: VenueController = venueController): VenueView {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  return {
    hydrated: snapshot.hydrated,
    status: snapshot.status,
    venue: snapshot.venue,
    visit: snapshot.visit,
    ready: visitReady(snapshot),
    visitId: venueContext(snapshot).visitId,
    options: snapshot.options,
    fix: snapshot.fix,
    failure: snapshot.error,
    resolve: controller.resolve,
    confirm: controller.confirm,
    dismiss: controller.dismiss,
    declinePrompt: controller.declinePrompt,
    promptChooser: controller.promptChooser,
    end: controller.end,
    discard: controller.discard,
    startVisit: controller.startVisit,
    move: controller.move,
  };
}

/** Mounted once under the database gate: resolves on launch and foreground, opens the sheet the camera asks for, syncs the visit. */
export function VenueResolver({ controller = venueController }: { controller?: VenueController }): null {
  const owner = useLocalOwner();
  const router = useRouter();
  const { isAuthenticated } = useConvexAuth();
  const device = useQuery(api.devices.me, isAuthenticated ? {} : "skip");
  const network = useNetworkState();
  const offline = isOffline(network);
  const prompt = useSyncExternalStore(
    controller.subscribe,
    () => controller.getState().prompt,
    () => controller.getState().prompt,
  );
  const seenPrompt = useRef(prompt);
  const introduction = useIntroduction();

  useEffect(() => {
    // A first launch checks location only after the welcome's Access page has asked for it.
    if (introduction === "pending") return;
    void controller
      .hydrate()
      .then(() => controller.resolve())
      .catch((error: unknown) => {
        reportError(error, "venue.visit.restore");
        console.warn("Could not restore the visit", error);
      });
    refreshVenueTableInBackground();
    const subscription = AppState.addEventListener("change", controller.appStateChanged);
    return () => subscription.remove();
  }, [controller, owner, introduction]);

  useEffect(() => {
    if (device && !offline) {
      void controller.syncRemoteVisit();
    }
  }, [controller, device, offline]);

  useEffect(() => {
    if (prompt === seenPrompt.current) return;
    seenPrompt.current = prompt;
    // The prompt asks where the phone is now, so the sheet lists the candidates even while a visit is paused elsewhere.
    router.push({ pathname: "/venue-picker", params: { mode: "choose" } });
  }, [prompt, router]);

  return null;
}
