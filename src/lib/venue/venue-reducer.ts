import type { Id } from '../../../convex/_generated/dataModel';
import { calendarDate } from '../../../shared/journal/limits';
import { CHOOSE_RADIUS_M, haversineMeters, type Coordinate, type VenueCandidate, type VenueResolution } from './resolve';

/** A fix younger than this is reused instead of asking Core Location again. */
export const FIX_MAX_AGE_MS = 3 * 60 * 1000;

export type SeededOption = { kind: 'seeded'; venueId: Id<'museums'>; name: string; distanceM?: number; website?: string; manual?: boolean };
export type PoiOption = { kind: 'poi'; name: string; lat: number; lng: number; distanceM?: number; website?: string; city?: string; country?: string; category: string };
export type VenueOption = SeededOption | PoiOption;

export function venueOptionKey(option: VenueOption): string {
  return option.kind === 'seeded' ? option.venueId : `poi:${option.name}:${option.lat}:${option.lng}`;
}

export type CurrentVisit = {
  localId: string;
  venueId: Id<'museums'>;
  venueName: string;
  startedAt: number;
  manual?: boolean;
  /** The visit's calendar day in the museum's time zone; the visit resumes while today is that day. */
  visitedOn: string;
  timeZone: string;
  remoteVisitId?: Id<'visits'>;
};

export type Fix = Coordinate & { at: number };
export type VenueStatus = 'idle' | 'locating' | 'resolved' | 'choose' | 'none' | 'denied';

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
  /** Where "Not here" was tapped; no prompt reappears within 400 m of it until a venue is confirmed. */
  dismissedNear?: Coordinate;
  /** A visit ended by hand today; location alone starts no new visit at that museum until tomorrow. */
  ended?: Pick<CurrentVisit, 'venueId' | 'visitedOn' | 'timeZone'>;
  error?: string;
};

export type VenueEvent =
  | { type: 'hydrated'; visit?: CurrentVisit; ended?: VenueState['ended'] }
  | { type: 'locating' }
  | { type: 'denied' }
  | { type: 'failed'; error: string }
  | { type: 'resolved'; fix: Fix; resolution: VenueResolution }
  | { type: 'poiOptions'; options: PoiOption[] }
  | { type: 'chosen'; option: SeededOption; replaces: VenueOption }
  | { type: 'visitStarted'; visit: CurrentVisit }
  | { type: 'visitEnded'; localId: string; manual?: boolean }
  | { type: 'remoteVisit'; localId: string; remoteVisitId: Id<'visits'> }
  | { type: 'dismissed' }
  | { type: 'backgrounded' };

export const initialVenueState: VenueState = { status: 'idle', options: [], prompt: 0 };

export type VenueContext = { venueId?: Id<'museums'>; visitLocalId?: string; visitId?: Id<'visits'> };

export function toSeededOption(candidate: VenueCandidate): SeededOption {
  return {
    kind: 'seeded', venueId: candidate.id, name: candidate.name, distanceM: candidate.distanceM,
    ...(candidate.website ? { website: candidate.website } : {}),
  };
}

/** A visit resumes for the rest of its calendar day at the museum; the next day starts a new one. */
export function isVisitToday(visit: Pick<CurrentVisit, 'visitedOn' | 'timeZone'>, now: number): boolean {
  return calendarDate(now, visit.timeZone) === visit.visitedOn;
}

export function needsFix(state: VenueState, now: number): boolean {
  return state.fix === undefined || now - state.fix.at >= FIX_MAX_AGE_MS;
}

/** The open visit while the phone is at its museum; undefined while it is paused elsewhere. */
export function activeVisit(state: Pick<VenueState, 'venue' | 'visit'>): CurrentVisit | undefined {
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

function promptAllowed(state: VenueState, at: Coordinate): boolean {
  return state.dismissedNear === undefined || haversineMeters(state.dismissedNear, at) > CHOOSE_RADIUS_M;
}

export function venueReducer(state: VenueState, event: VenueEvent): VenueState {
  switch (event.type) {
    case 'hydrated':
      if (!event.visit) return { ...state, visit: undefined, ended: event.ended };
      return {
        ...state, visit: event.visit, ended: undefined,
        venue: { kind: 'seeded', venueId: event.visit.venueId, name: event.visit.venueName, manual: event.visit.manual },
      };
    case 'locating':
      return { ...state, status: 'locating', error: undefined };
    case 'denied':
      if (state.venue?.manual && state.visit) return { ...state, status: 'resolved', fix: undefined };
      return { ...state, status: 'denied', venue: undefined, visit: undefined, options: [], fix: undefined };
    case 'failed':
      return { ...state, status: state.venue ? 'resolved' : 'none', error: event.error };
    case 'resolved': {
      const { fix, resolution } = event;
      if (state.venue?.manual && state.visit && isVisitToday(state.visit, fix.at)) return { ...state, status: 'resolved', fix, error: undefined };
      const base = { ...state, fix, error: undefined };
      if (resolution.kind === 'auto') {
        if (!promptAllowed(state, fix)) {
          return { ...base, status: 'none', venue: undefined, options: resolution.options.map(toSeededOption) };
        }
        return { ...base, status: 'resolved', venue: toSeededOption(resolution.venue), options: resolution.options.map(toSeededOption) };
      }
      if (resolution.kind === 'choose') {
        const options = resolution.options.map(toSeededOption);
        const current = state.visit && isVisitToday(state.visit, fix.at)
          ? options.find((option) => option.venueId === state.visit?.venueId)
          : undefined;
        if (current) return { ...base, status: 'resolved', venue: current, options };
        return { ...base, status: 'choose', venue: undefined, options, prompt: promptAllowed(state, fix) ? state.prompt + 1 : state.prompt };
      }
      // Leaving the radius pauses the visit; it resumes on return the same day and closes with the day, a new venue, or End.
      return { ...base, status: 'none', venue: undefined, options: [] };
    }
    case 'poiOptions': {
      if (state.status !== 'none' || !state.fix) return state;
      const prompt = event.options.length > 0 && promptAllowed(state, state.fix) ? state.prompt + 1 : state.prompt;
      return { ...state, options: event.options, prompt };
    }
    case 'chosen': {
      const selectedKey = venueOptionKey(event.replaces);
      const options = [event.option, ...state.options.filter((option) =>
        venueOptionKey(option) !== selectedKey && venueOptionKey(option) !== event.option.venueId)];
      // Confirming the museum ended by hand today says its visits are wanted again; saves there default to one.
      const ended = state.ended?.venueId === event.option.venueId ? undefined : state.ended;
      return { ...state, status: 'resolved', venue: event.option, options, dismissedNear: undefined, ended, error: undefined };
    }
    case 'visitStarted':
      return { ...state, visit: event.visit, ended: undefined };
    case 'visitEnded': {
      const visit = state.visit;
      if (visit?.localId !== event.localId) return state;
      const ended = event.manual ? { venueId: visit.venueId, visitedOn: visit.visitedOn, timeZone: visit.timeZone } : state.ended;
      return { ...state, visit: undefined, ended, ...(state.venue?.manual && state.venue.venueId === visit.venueId ? { venue: undefined, status: 'none' as const } : {}) };
    }
    case 'remoteVisit':
      if (state.visit?.localId !== event.localId) return state;
      return { ...state, visit: { ...state.visit, remoteVisitId: event.remoteVisitId } };
    case 'dismissed': {
      // "Not here" rejects the resolved venue and its visit; a visit paused elsewhere stays open.
      const rejected = state.visit !== undefined && state.visit.venueId === state.venue?.venueId;
      return {
        ...state,
        status: state.status === 'resolved' ? 'none' : state.status,
        venue: undefined,
        visit: rejected ? undefined : state.visit,
        dismissedNear: state.fix ? { lat: state.fix.lat, lng: state.fix.lng } : state.dismissedNear,
      };
    }
    case 'backgrounded':
      return { ...state, fix: undefined };
  }
}

/** Location alone does not restart a visit the person ended by hand at that museum today. */
export function endedToday(state: VenueState, venueId: Id<'museums'>, now: number): boolean {
  return state.ended?.venueId === venueId && isVisitToday(state.ended, now);
}
