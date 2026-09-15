import type { Id } from '../../../convex/_generated/dataModel';
import { CHOOSE_RADIUS_M, haversineMeters, type Coordinate, type VenueCandidate, type VenueResolution } from './resolve';

/** A fix younger than this is reused instead of asking Core Location again. */
export const FIX_MAX_AGE_MS = 3 * 60 * 1000;
/** A still-active local scan session may reuse its existing UUID within this window. */
export const VISIT_RESUME_MS = 4 * 60 * 60 * 1000;

export type SeededOption = { kind: 'seeded'; venueId: Id<'museums'>; name: string; distanceM?: number; website?: string };
export type PoiOption = { kind: 'poi'; name: string; lat: number; lng: number; distanceM: number; website?: string; city?: string; country?: string; category: string };
export type VenueOption = SeededOption | PoiOption;

export function venueOptionKey(option: VenueOption): string {
  return option.kind === 'seeded' ? option.venueId : `poi:${option.name}:${option.lat}:${option.lng}`;
}

export type CurrentVisit = {
  localId: string;
  venueId: Id<'museums'>;
  venueName: string;
  startedAt: number;
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
  error?: string;
};

export type VenueEvent =
  | { type: 'hydrated'; visit?: CurrentVisit }
  | { type: 'locating' }
  | { type: 'denied' }
  | { type: 'failed'; error: string }
  | { type: 'resolved'; fix: Fix; resolution: VenueResolution }
  | { type: 'poiOptions'; options: PoiOption[] }
  | { type: 'chosen'; option: SeededOption; replaces: VenueOption }
  | { type: 'visitStarted'; visit: CurrentVisit }
  | { type: 'visitEnded'; localId: string }
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

export function isVisitFresh(visit: { startedAt: number }, now: number): boolean {
  return now - visit.startedAt < VISIT_RESUME_MS;
}

export function needsFix(state: VenueState, now: number): boolean {
  return state.fix === undefined || now - state.fix.at >= FIX_MAX_AGE_MS;
}

/** What a scan sends: the resolved venue, plus the visit only when it is at that venue. */
export function venueContext(state: VenueState): VenueContext {
  if (!state.venue) return {};
  const visit = state.visit?.venueId === state.venue.venueId ? state.visit : undefined;
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
      if (!event.visit) return { ...state, visit: undefined };
      return {
        ...state, visit: event.visit,
        venue: { kind: 'seeded', venueId: event.visit.venueId, name: event.visit.venueName },
      };
    case 'locating':
      return { ...state, status: 'locating', error: undefined };
    case 'denied':
      return { ...state, status: 'denied', venue: undefined, visit: undefined, options: [], fix: undefined };
    case 'failed':
      return { ...state, status: state.venue ? 'resolved' : 'none', error: event.error };
    case 'resolved': {
      const { fix, resolution } = event;
      const base = { ...state, fix, error: undefined };
      if (resolution.kind === 'auto') {
        if (!promptAllowed(state, fix)) {
          return { ...base, status: 'none', venue: undefined, visit: undefined, options: resolution.options.map(toSeededOption) };
        }
        return { ...base, status: 'resolved', venue: toSeededOption(resolution.venue), options: resolution.options.map(toSeededOption) };
      }
      if (resolution.kind === 'choose') {
        const options = resolution.options.map(toSeededOption);
        const current = state.visit && isVisitFresh(state.visit, fix.at)
          ? options.find((option) => option.venueId === state.visit?.venueId)
          : undefined;
        if (current) return { ...base, status: 'resolved', venue: current, options };
        return { ...base, status: 'choose', venue: undefined, options, prompt: promptAllowed(state, fix) ? state.prompt + 1 : state.prompt };
      }
      return { ...base, status: 'none', venue: undefined, visit: undefined, options: [] };
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
      return { ...state, status: 'resolved', venue: event.option, options, dismissedNear: undefined, error: undefined };
    }
    case 'visitStarted':
      return { ...state, visit: event.visit };
    case 'visitEnded':
      return state.visit?.localId === event.localId ? { ...state, visit: undefined } : state;
    case 'remoteVisit':
      if (state.visit?.localId !== event.localId) return state;
      return { ...state, visit: { ...state.visit, remoteVisitId: event.remoteVisitId } };
    case 'dismissed':
      return {
        ...state,
        status: state.status === 'resolved' ? 'none' : state.status,
        venue: undefined,
        visit: undefined,
        dismissedNear: state.fix ? { lat: state.fix.lat, lng: state.fix.lng } : state.dismissedNear,
      };
    case 'backgrounded':
      return { ...state, fix: undefined };
  }
}
