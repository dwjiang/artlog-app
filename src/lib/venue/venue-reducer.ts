import { calendarDate } from "@/shared/journal/limits";

import type { Id } from "../../../convex/_generated/dataModel";
import { type Coordinate, type VenueCandidate, type VenueResolution } from "./resolve";

/** A fix younger than this is reused instead of asking Core Location again. */
export const FIX_MAX_AGE_MS = 3 * 60 * 1000;
/** How long "Not here" keeps the museums it was tapped over from resolving or opening the sheet. */
export const NOT_HERE_MS = 2 * 60 * 60 * 1000;

/** A calendar day in a museum's time zone; visits and hand-picked museums both live by it. */
export type MuseumDay = Pick<CurrentVisit, "visitedOn" | "timeZone">;
/** `manual` is the museum day the sheet's search picked it on; the choice stands for the rest of that day without a location fix. */
export type SeededOption = {
  kind: "seeded";
  venueId: Id<"museums">;
  name: string;
  distanceM?: number;
  website?: string;
  manual?: MuseumDay;
};
export type PoiOption = {
  kind: "poi";
  name: string;
  lat: number;
  lng: number;
  distanceM?: number;
  website?: string;
  city?: string;
  country?: string;
  category: string;
};
export type VenueOption = SeededOption | PoiOption;

export function venueOptionKey(option: VenueOption): string {
  return option.kind === "seeded" ? option.venueId : `poi:${option.name}:${option.lat}:${option.lng}`;
}

export type CurrentVisit = {
  localId: string;
  venueId: Id<"museums">;
  venueName: string;
  startedAt: number;
  manual?: boolean;
  /** The calendar day the visit started, in the museum's time zone; the visit stays open past it until ended by hand. */
  visitedOn: string;
  timeZone: string;
  remoteVisitId?: Id<"visits">;
};

/** A museum confirmed in the sheet and the museum day it was confirmed on. */
export type VenuePick = { venueId: Id<"museums"> } & MuseumDay;

export type Fix = Coordinate & { at: number };
export type VenueStatus = "idle" | "locating" | "resolved" | "choose" | "none" | "denied";

export type VenueState = {
  status: VenueStatus;
  /** The venue the last fix resolved to, or the hydrated visit's venue before the first fix. */
  venue?: SeededOption;
  visit?: CurrentVisit;
  /** Seeded rows within 400 m, or MapKit places when nothing seeded is near; what the sheet lists. */
  options: VenueOption[];
  fix?: Fix;
  /** Changes whenever the picker should open; consumers react to the change, not the value. */
  prompt: number;
  /** For the rest of its day, a fix that lists this museum resolves to it instead of asking again, until a visit elsewhere takes over. */
  picked?: VenuePick;
  /** When "Not here" lapses for each option key it was tapped over. */
  notHere: Record<string, number>;
  /** The museum and day a visit was ended there; location alone starts no new visit at that museum until the next day. */
  ended?: { venueId: Id<"museums"> } & MuseumDay;
  error?: string;
};

/** `quiet` resolutions never open the sheet; a scan's is quiet so the sheet never covers the camera or result. */
export type VenueEvent =
  | {
      type: "hydrated";
      at: number;
      visit?: CurrentVisit;
      ended?: VenueState["ended"];
      picked?: VenuePick;
      notHere?: VenueState["notHere"];
    }
  | { type: "locating" }
  | { type: "denied"; at: number }
  | { type: "failed"; error: string }
  | { type: "resolved"; fix: Fix; resolution: VenueResolution; quiet?: boolean }
  | { type: "poiOptions"; options: PoiOption[]; quiet?: boolean }
  | {
      type: "chosen";
      option: SeededOption;
      replaces: VenueOption;
      day: MuseumDay;
    }
  | { type: "visitStarted"; visit: CurrentVisit }
  | { type: "visitEnded"; localId: string; at: number }
  | { type: "remoteVisit"; localId: string; remoteVisitId: Id<"visits"> }
  | { type: "dismissed"; at: number }
  | { type: "backgrounded" };

export const initialVenueState: VenueState = {
  status: "idle",
  options: [],
  prompt: 0,
  notHere: {},
};

export type VenueContext = {
  venueId?: Id<"museums">;
  visitLocalId?: string;
  visitId?: Id<"visits">;
};

export function toSeededOption(candidate: VenueCandidate): SeededOption {
  return {
    kind: "seeded",
    venueId: candidate.id,
    name: candidate.name,
    distanceM: candidate.distanceM,
    ...(candidate.website ? { website: candidate.website } : {}),
  };
}

/** Whether `now` falls on this calendar day in its time zone. */
export function isVisitToday(visit: Pick<CurrentVisit, "visitedOn" | "timeZone">, now: number): boolean {
  return calendarDate(now, visit.timeZone) === visit.visitedOn;
}

export function needsFix(state: VenueState, now: number): boolean {
  return state.fix === undefined || now - state.fix.at >= FIX_MAX_AGE_MS;
}

/**
 * What a save at a museum does with the one open visit, which only the person ends: `join` it (a capture at its museum
 * from its day on), give a capture from an earlier day or from before the visit began a `past` visit spanning exactly
 * its saves, `start` today's visit when none is open, or wait for the open one to end first.
 */
export type SaveVisitPlan = "join" | "past" | "start" | "endFirst";
export function planSaveVisit(
  open: Pick<CurrentVisit, "venueId" | "visitedOn" | "startedAt"> | undefined,
  venueId: Id<"museums">,
  capture: MuseumDay & { at: number },
  now: number,
): SaveVisitPlan {
  if (open?.venueId === venueId && capture.visitedOn >= open.visitedOn) return "join";
  if (!isVisitToday(capture, now) || (open && capture.at < open.startedAt)) return "past";
  return open ? "endFirst" : "start";
}

/** The open visit while the phone is at its museum; undefined while it is paused elsewhere. */
export function activeVisit(state: Pick<VenueState, "venue" | "visit">): CurrentVisit | undefined {
  return state.visit && state.visit.venueId === state.venue?.venueId ? state.visit : undefined;
}

/** What a scan sends: the resolved venue, plus the visit only when it is at that venue. */
export function venueContext(state: VenueState): VenueContext {
  if (!state.venue) return {};
  const visit = activeVisit(state);
  return {
    venueId: state.venue.venueId,
    ...(visit ? { visitLocalId: visit.localId } : {}),
    ...(visit?.remoteVisitId ? { visitId: visit.remoteVisitId } : {}),
  };
}

function isNotHere(state: VenueState, key: string, at: number): boolean {
  return (state.notHere[key] ?? 0) > at;
}

/** Any listed option under "Not here" means the person already turned this spot down. */
function promptAllowed(state: VenueState, options: VenueOption[], at: number): boolean {
  return options.length > 0 && options.every((option) => !isNotHere(state, venueOptionKey(option), at));
}

export function venueReducer(state: VenueState, event: VenueEvent): VenueState {
  switch (event.type) {
    case "hydrated": {
      const answers = { picked: event.picked, notHere: event.notHere ?? {} };
      if (!event.visit) {
        return { ...state, ...answers, visit: undefined, ended: event.ended };
      }
      // Before the first fix, only a visit from today stands in for the phone's museum; an older one stays paused.
      if (!isVisitToday(event.visit, event.at)) {
        return { ...state, ...answers, visit: event.visit, ended: undefined };
      }
      return {
        ...state,
        ...answers,
        visit: event.visit,
        ended: undefined,
        venue: {
          kind: "seeded",
          venueId: event.visit.venueId,
          name: event.visit.venueName,
          ...(event.visit.manual
            ? {
                manual: {
                  visitedOn: event.visit.visitedOn,
                  timeZone: event.visit.timeZone,
                },
              }
            : {}),
        },
      };
    }
    case "locating":
      return { ...state, status: "locating", error: undefined };
    case "denied":
      if (state.venue?.manual && state.visit && isVisitToday(state.visit, event.at)) {
        return { ...state, status: "resolved", fix: undefined };
      }
      // Without location the visit pauses like leaving the museum, whether access was declined or left unanswered.
      return {
        ...state,
        status: "denied",
        venue: undefined,
        options: [],
        fix: undefined,
      };
    case "failed":
      return {
        ...state,
        status: state.venue ? "resolved" : "none",
        error: event.error,
      };
    case "resolved": {
      const { fix, resolution } = event;
      if (state.venue?.manual && state.visit && isVisitToday(state.visit, fix.at)) {
        return { ...state, status: "resolved", fix, error: undefined };
      }
      const base = { ...state, fix, error: undefined };
      if (resolution.kind === "auto") {
        if (isNotHere(state, resolution.venue.id, fix.at)) {
          return {
            ...base,
            status: "none",
            venue: undefined,
            options: resolution.options.map(toSeededOption),
          };
        }
        return {
          ...base,
          status: "resolved",
          venue: toSeededOption(resolution.venue),
          options: resolution.options.map(toSeededOption),
        };
      }
      if (resolution.kind === "choose") {
        const options = resolution.options.map(toSeededOption);
        const listedToday = (kept?: MuseumDay & { venueId: Id<"museums"> }) =>
          kept && isVisitToday(kept, fix.at) ? options.find((option) => option.venueId === kept.venueId) : undefined;
        // Picking from the list sets today's visit elsewhere aside; a visit taking over since then drops the pick.
        const current = listedToday(state.picked) ?? listedToday(state.visit);
        if (current) {
          return { ...base, status: "resolved", venue: current, options };
        }
        return {
          ...base,
          status: "choose",
          venue: undefined,
          options,
          prompt: !event.quiet && promptAllowed(state, options, fix.at) ? state.prompt + 1 : state.prompt,
        };
      }
      // Leaving the radius pauses the visit; it resumes on return and stays open until ended by hand.
      return { ...base, status: "none", venue: undefined, options: [] };
    }
    case "poiOptions": {
      if (state.status !== "none" || !state.fix) return state;
      const prompt =
        !event.quiet && promptAllowed(state, event.options, state.fix.at) ? state.prompt + 1 : state.prompt;
      return { ...state, options: event.options, prompt };
    }
    case "chosen": {
      const selectedKey = venueOptionKey(event.replaces);
      const options = [
        event.option,
        ...state.options.filter(
          (option) => venueOptionKey(option) !== selectedKey && venueOptionKey(option) !== event.option.venueId,
        ),
      ];
      // Confirming the museum ended by hand today says its visits are wanted again; saves there default to one.
      const ended = state.ended?.venueId === event.option.venueId ? undefined : state.ended;
      const notHere = Object.fromEntries(
        Object.entries(state.notHere).filter(([key]) => key !== selectedKey && key !== event.option.venueId),
      );
      return {
        ...state,
        status: "resolved",
        venue: event.option,
        options,
        picked: { venueId: event.option.venueId, ...event.day },
        notHere,
        ended,
        error: undefined,
      };
    }
    case "visitStarted": {
      const tookOver = event.visit.localId !== state.visit?.localId && event.visit.venueId !== state.picked?.venueId;
      return {
        ...state,
        visit: event.visit,
        ended: undefined,
        picked: tookOver ? undefined : state.picked,
      };
    }
    case "visitEnded": {
      const { visit } = state;
      if (visit?.localId !== event.localId) return state;
      return {
        ...state,
        visit: undefined,
        ended: {
          venueId: visit.venueId,
          visitedOn: calendarDate(event.at, visit.timeZone),
          timeZone: visit.timeZone,
        },
        ...(state.venue?.manual && state.venue.venueId === visit.venueId
          ? { venue: undefined, status: "none" as const }
          : {}),
      };
    }
    case "remoteVisit":
      if (state.visit?.localId !== event.localId) return state;
      return {
        ...state,
        visit: { ...state.visit, remoteVisitId: event.remoteVisitId },
      };
    case "dismissed": {
      // "Not here" rejects the listed options and the resolved venue; its visit pauses and stays open until ended by hand.
      const keys = new Set(state.options.map(venueOptionKey));
      if (state.venue) keys.add(state.venue.venueId);
      const notHere = Object.fromEntries([
        ...Object.entries(state.notHere).filter(([, until]) => until > event.at),
        ...[...keys].map((key) => [key, event.at + NOT_HERE_MS] as const),
      ]);
      return {
        ...state,
        status: state.status === "resolved" ? "none" : state.status,
        venue: undefined,
        picked: state.picked && keys.has(state.picked.venueId) ? undefined : state.picked,
        notHere,
      };
    }
    case "backgrounded":
      return { ...state, fix: undefined };
  }
}

/** Location alone does not restart a visit the person ended by hand at that museum today. */
export function endedToday(state: VenueState, venueId: Id<"museums">, now: number): boolean {
  return state.ended?.venueId === venueId && isVisitToday(state.ended, now);
}
