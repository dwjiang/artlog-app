import type { Id } from '../../../convex/_generated/dataModel';
import type { VenueCandidate } from './resolve';
import {
  endedToday, FIX_MAX_AGE_MS, initialVenueState, needsFix, venueContext, venueReducer,
  type CurrentVisit, type PoiOption, type VenueState,
} from './venue-reducer';

const met = { lat: 40.779444444, lng: -73.963333333 };
const fix = { ...met, at: 1_000_000 };

function candidate(name: string, distanceM: number): VenueCandidate {
  return { id: `id-${name}` as Id<'museums'>, key: `wikidata:${name}`, name, lat: 0, lng: 0, website: `https://${name}.example`, region: 'new-york', distanceM };
}

function visitAt(name: string, startedAt: number, remoteVisitId?: string, visitedOn = '1970-01-01'): CurrentVisit {
  return { localId: `local-${name}`, venueId: `id-${name}` as Id<'museums'>, venueName: name, startedAt, visitedOn, timeZone: 'UTC', remoteVisitId: remoteVisitId as Id<'visits'> | undefined };
}

function reduce(events: Parameters<typeof venueReducer>[1][], from: VenueState = initialVenueState): VenueState {
  return events.reduce(venueReducer, from);
}

describe('resolving a fix', () => {
  it('resolves automatically and lists the venue as the only option', () => {
    const state = reduce([{ type: 'locating' }, { type: 'resolved', fix, resolution: { kind: 'auto', venue: candidate('Met', 40), options: [candidate('Met', 40)] } }]);
    expect(state.status).toBe('resolved');
    expect(state.venue).toEqual({ kind: 'seeded', venueId: 'id-Met', name: 'Met', distanceM: 40, website: 'https://Met.example' });
    expect(state.options).toHaveLength(1);
    expect(state.prompt).toBe(0);
    expect(state.fix).toEqual(fix);
  });

  it('asks between two seeded venues and raises the prompt once', () => {
    const state = reduce([{ type: 'resolved', fix, resolution: { kind: 'choose', options: [candidate('Met', 90), candidate('Neue', 300)] } }]);
    expect(state.status).toBe('choose');
    expect(state.venue).toBeUndefined();
    expect(state.options.map((option) => option.name)).toEqual(['Met', 'Neue']);
    expect(state.prompt).toBe(1);
  });

  it('keeps a same-day visit at one of the ambiguous venues instead of asking again', () => {
    const state = reduce([
      { type: 'hydrated', visit: visitAt('Neue', fix.at - 60_000, 'remote-neue') },
      { type: 'resolved', fix, resolution: { kind: 'choose', options: [candidate('Met', 90), candidate('Neue', 300)] } },
    ]);
    expect(state.status).toBe('resolved');
    expect(state.venue?.name).toBe('Neue');
    expect(state.prompt).toBe(0);
    expect(venueContext(state)).toEqual({ venueId: 'id-Neue', visitLocalId: 'local-Neue', visitId: 'remote-neue' });
  });

  it('asks again when the visit at an ambiguous venue is from an earlier day', () => {
    const state = reduce([
      { type: 'hydrated', visit: visitAt('Neue', fix.at - 60_000, undefined, '1969-12-31') },
      { type: 'resolved', fix, resolution: { kind: 'choose', options: [candidate('Met', 90), candidate('Neue', 300)] } },
    ]);
    expect(state.status).toBe('choose');
    expect(state.prompt).toBe(1);
  });

  it('pauses the visit when nothing seeded is nearby: no venue for scans, but the visit stays open', () => {
    const state = reduce([
      { type: 'hydrated', visit: visitAt('Met', fix.at - 1000) },
      { type: 'resolved', fix, resolution: { kind: 'none' } },
    ]);
    expect(state).toMatchObject({ status: 'none', venue: undefined, options: [], prompt: 0 });
    expect(state.visit?.localId).toBe('local-Met');
    expect(venueContext(state)).toEqual({});
    const back = venueReducer(state, { type: 'resolved', fix: { ...fix, at: fix.at + FIX_MAX_AGE_MS }, resolution: { kind: 'auto', venue: candidate('Met', 40), options: [candidate('Met', 40)] } });
    expect(venueContext(back)).toEqual({ venueId: 'id-Met', visitLocalId: 'local-Met' });
  });

  it('keeps the last venue after a failed fix but reports the error', () => {
    const resolved = reduce([{ type: 'resolved', fix, resolution: { kind: 'auto', venue: candidate('Met', 40), options: [candidate('Met', 40)] } }]);
    const failed = reduce([{ type: 'locating' }, { type: 'failed', error: 'Location unavailable' }], resolved);
    expect(failed.status).toBe('resolved');
    expect(failed.venue?.name).toBe('Met');
    expect(failed.error).toBe('Location unavailable');
    expect(reduce([{ type: 'failed', error: 'x' }]).status).toBe('none');
  });

  it('drops the venue, visit and fix when location access is denied', () => {
    const state = reduce([{ type: 'hydrated', visit: visitAt('Met', fix.at) }, { type: 'denied' }]);
    expect(state).toMatchObject({ status: 'denied', venue: undefined, visit: undefined, fix: undefined });
  });
});

describe('nearby places', () => {
  const poi: PoiOption = { kind: 'poi', name: 'Small Gallery', lat: met.lat, lng: met.lng, distanceM: 80, category: 'unknown' };

  it('prompts with MapKit places only after a fix found nothing seeded', () => {
    const none = reduce([{ type: 'resolved', fix, resolution: { kind: 'none' } }]);
    const state = venueReducer(none, { type: 'poiOptions', options: [poi] });
    expect(state.options).toEqual([poi]);
    expect(state.prompt).toBe(1);
    expect(venueReducer(none, { type: 'poiOptions', options: [] }).prompt).toBe(0);
  });

  it('ignores a search result that arrives after a newer fix resolved a venue', () => {
    const resolved = reduce([{ type: 'resolved', fix, resolution: { kind: 'auto', venue: candidate('Met', 40), options: [candidate('Met', 40)] } }]);
    expect(venueReducer(resolved, { type: 'poiOptions', options: [poi] })).toBe(resolved);
  });

  it('replaces a confirmed place with its seeded venue and clears the dismissal', () => {
    const none = reduce([{ type: 'resolved', fix, resolution: { kind: 'none' } }, { type: 'poiOptions', options: [poi] }, { type: 'dismissed' }]);
    const state = venueReducer(none, { type: 'chosen', replaces: poi, option: { kind: 'seeded', venueId: 'id-gallery' as Id<'museums'>, name: 'Small Gallery', distanceM: 80 } });
    expect(state.status).toBe('resolved');
    expect(state.venue?.venueId).toBe('id-gallery');
    expect(state.options).toEqual([state.venue]);
    expect(state.dismissedNear).toBeUndefined();
  });
});

describe('"Not here"', () => {
  const choose = reduce([{ type: 'hydrated', visit: visitAt('Old', fix.at - 1000) }, { type: 'resolved', fix, resolution: { kind: 'choose', options: [candidate('Met', 90), candidate('Neue', 300)] } }]);

  it('keeps a visit paused elsewhere and suppresses prompts within 400 m of the dismissal', () => {
    const dismissed = venueReducer(choose, { type: 'dismissed' });
    expect(dismissed.visit?.localId).toBe('local-Old');
    expect(dismissed.dismissedNear).toEqual(met);
    const nearby = { lat: met.lat + 0.002, lng: met.lng, at: fix.at + FIX_MAX_AGE_MS };
    const again = venueReducer(dismissed, { type: 'resolved', fix: nearby, resolution: { kind: 'choose', options: [candidate('Met', 90), candidate('Neue', 300)] } });
    expect(again.status).toBe('choose');
    expect(again.prompt).toBe(dismissed.prompt);
    // The paused visit also survives its museum resolving automatically next to the dismissal.
    const home = venueReducer(dismissed, { type: 'resolved', fix: nearby, resolution: { kind: 'auto', venue: candidate('Old', 40), options: [candidate('Old', 40)] } });
    expect(home).toMatchObject({ status: 'none', venue: undefined });
    expect(home.visit?.localId).toBe('local-Old');
    const farther = { lat: met.lat + 0.005, lng: met.lng, at: fix.at + FIX_MAX_AGE_MS };
    expect(venueReducer(dismissed, { type: 'resolved', fix: farther, resolution: { kind: 'choose', options: [candidate('A', 90), candidate('B', 300)] } }).prompt).toBe(dismissed.prompt + 1);
  });

  it('ends the visit and drops the venue when tapped over a resolved venue, keeping the options', () => {
    const resolved = reduce([{ type: 'resolved', fix, resolution: { kind: 'auto', venue: candidate('Met', 40), options: [candidate('Met', 40)] } }, { type: 'visitStarted', visit: visitAt('Met', fix.at) }]);
    const dismissed = venueReducer(resolved, { type: 'dismissed' });
    expect(dismissed).toMatchObject({ status: 'none', venue: undefined, visit: undefined, dismissedNear: met });
    expect(dismissed.options.map((option) => option.name)).toEqual(['Met']);
    expect(venueContext(dismissed)).toEqual({});
  });
});

describe('visits and the scan context', () => {
  const resolved = reduce([{ type: 'resolved', fix, resolution: { kind: 'auto', venue: candidate('Met', 40), options: [candidate('Met', 40)] } }]);

  it('keeps the local visit link before its remote ID is available', () => {
    expect(venueContext(resolved)).toEqual({ venueId: 'id-Met' });
    const started = venueReducer(resolved, { type: 'visitStarted', visit: visitAt('Met', fix.at) });
    expect(venueContext(started)).toEqual({ venueId: 'id-Met', visitLocalId: 'local-Met' });
    const remote = venueReducer(started, { type: 'remoteVisit', localId: 'local-Met', remoteVisitId: 'remote-1' as Id<'visits'> });
    expect(venueContext(remote)).toEqual({ venueId: 'id-Met', visitLocalId: 'local-Met', visitId: 'remote-1' });
    expect(venueReducer(started, { type: 'remoteVisit', localId: 'other', remoteVisitId: 'remote-2' as Id<'visits'> })).toBe(started);
  });

  it('never attaches a visit from another venue', () => {
    const state = venueReducer(resolved, { type: 'visitStarted', visit: visitAt('Old', fix.at, 'remote-old') });
    expect(venueContext(state)).toEqual({ venueId: 'id-Met' });
    expect(venueContext(initialVenueState)).toEqual({});
  });

  it('shows the hydrated visit as the venue before the first fix', () => {
    const state = reduce([{ type: 'hydrated', visit: visitAt('Met', fix.at, 'remote-1') }]);
    expect(state.status).toBe('idle');
    expect(venueContext(state)).toEqual({ venueId: 'id-Met', visitLocalId: 'local-Met', visitId: 'remote-1' });
  });
});

describe('fix reuse', () => {
  it('reuses a fix for three minutes unless the app was backgrounded', () => {
    const resolved = reduce([{ type: 'resolved', fix, resolution: { kind: 'none' } }]);
    expect(needsFix(initialVenueState, fix.at)).toBe(true);
    expect(needsFix(resolved, fix.at + FIX_MAX_AGE_MS - 1)).toBe(false);
    expect(needsFix(resolved, fix.at + FIX_MAX_AGE_MS)).toBe(true);
    expect(needsFix(venueReducer(resolved, { type: 'backgrounded' }), fix.at + 1)).toBe(true);
  });
});

describe('a visit ended by hand', () => {
  const resolved = reduce([{ type: 'resolved', fix, resolution: { kind: 'auto', venue: candidate('Met', 40), options: [candidate('Met', 40)] } }, { type: 'visitStarted', visit: visitAt('Met', fix.at) }]);

  it('is remembered for the rest of its day at that museum only', () => {
    const ended = venueReducer(resolved, { type: 'visitEnded', localId: 'local-Met', manual: true });
    expect(ended.visit).toBeUndefined();
    expect(endedToday(ended, 'id-Met' as Id<'museums'>, fix.at + 60_000)).toBe(true);
    expect(endedToday(ended, 'id-Neue' as Id<'museums'>, fix.at + 60_000)).toBe(false);
    expect(endedToday(ended, 'id-Met' as Id<'museums'>, fix.at + 24 * 60 * 60 * 1000)).toBe(false);
    expect(venueReducer(ended, { type: 'visitStarted', visit: visitAt('Met', fix.at + 1) }).ended).toBeUndefined();
  });

  it('is not remembered when the visit ended on its own, and is restored at launch', () => {
    expect(venueReducer(resolved, { type: 'visitEnded', localId: 'local-Met' }).ended).toBeUndefined();
    const restored = venueReducer(initialVenueState, { type: 'hydrated', ended: { venueId: 'id-Met' as Id<'museums'>, visitedOn: '1970-01-01', timeZone: 'UTC' } });
    expect(endedToday(restored, 'id-Met' as Id<'museums'>, fix.at)).toBe(true);
    expect(venueReducer(restored, { type: 'hydrated', visit: visitAt('Met', fix.at) }).ended).toBeUndefined();
  });
});
