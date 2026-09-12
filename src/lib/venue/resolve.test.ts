import type { Id } from '../../../convex/_generated/dataModel';
import { boundingBox, formatDistance, haversineMeters, pickVenue, rankCandidates, type VenueCandidate, type VenueRow } from './resolve';

const met = { lat: 40.779444444, lng: -73.963333333 };

function row(name: string, lat: number, lng: number): VenueRow {
  return { id: `id-${name}` as Id<'museums'>, key: `wikidata:${name}`, name, lat, lng, website: null, region: 'new-york' };
}

function candidate(name: string, distanceM: number): VenueCandidate {
  return { ...row(name, 0, 0), distanceM };
}

describe('haversineMeters', () => {
  it('is zero for the same point and symmetric', () => {
    expect(haversineMeters(met, met)).toBe(0);
    const other = { lat: 40.7794, lng: -73.9622 };
    expect(haversineMeters(met, other)).toBeCloseTo(haversineMeters(other, met), 9);
  });

  it('matches a known distance: the de Young to the Legion of Honor is about 3.1 km', () => {
    const deYoung = { lat: 37.771469, lng: -122.468676 };
    const legion = { lat: 37.784466, lng: -122.500842 };
    expect(haversineMeters(deYoung, legion)).toBeGreaterThan(3_000);
    expect(haversineMeters(deYoung, legion)).toBeLessThan(3_300);
  });

  it('treats one degree of latitude as about 111 km', () => {
    expect(haversineMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(111_195, -2);
  });
});

describe('boundingBox', () => {
  it('contains every point within the radius and widens with latitude', () => {
    const box = boundingBox(met, 400);
    expect(box.maxLat - met.lat).toBeCloseTo(400 / 111_000, 6);
    expect(box.maxLng - met.lng).toBeGreaterThan(box.maxLat - met.lat);
    const north = { lat: met.lat + 0.0035, lng: met.lng };
    expect(haversineMeters(met, north)).toBeLessThan(400);
    expect(north.lat).toBeLessThanOrEqual(box.maxLat);
    const east = { lat: met.lat, lng: met.lng + 0.0045 };
    expect(haversineMeters(met, east)).toBeLessThan(400);
    expect(east.lng).toBeLessThanOrEqual(box.maxLng);
  });

  it('clamps at the poles and the antimeridian', () => {
    expect(boundingBox({ lat: 89.9999, lng: 179.9999 }, 400)).toEqual(
      expect.objectContaining({ maxLat: 90, maxLng: 180 }),
    );
    expect(boundingBox({ lat: -89.9999, lng: -179.9999 }, 400)).toEqual(
      expect.objectContaining({ minLat: -90, minLng: -180 }),
    );
  });
});

describe('rankCandidates', () => {
  it('keeps only rows within the radius, nearest first, with their distances', () => {
    const near = row('near', met.lat + 0.0005, met.lng);
    const far = row('far', met.lat + 0.01, met.lng);
    const nearer = row('nearer', met.lat + 0.0002, met.lng);
    const ranked = rankCandidates([near, far, nearer], met, 400);
    expect(ranked.map((r) => r.name)).toEqual(['nearer', 'near']);
    expect(ranked[0].distanceM).toBeCloseTo(22.2, 0);
    expect(ranked[1].distanceM).toBeCloseTo(55.6, 0);
  });
});

describe('pickVenue', () => {
  it('resolves automatically to a single venue within 150 m', () => {
    expect(pickVenue([candidate('Met', 120)])).toEqual({ kind: 'auto', venue: candidate('Met', 120), options: [candidate('Met', 120)] });
  });

  it('accepts the 150 m boundary and rejects just beyond it', () => {
    expect(pickVenue([candidate('Met', 150)]).kind).toBe('auto');
    expect(pickVenue([candidate('Met', 150.5)]).kind).toBe('none');
  });

  it('asks when a second venue is within 400 m, even if the first is very close', () => {
    const result = pickVenue([candidate('Met', 20), candidate('Neue Galerie', 390)]);
    expect(result).toEqual({ kind: 'choose', options: [candidate('Met', 20), candidate('Neue Galerie', 390)] });
  });

  it('ignores a second venue beyond 400 m', () => {
    expect(pickVenue([candidate('Met', 20), candidate('Guggenheim', 401)])).toMatchObject({ kind: 'auto', venue: { name: 'Met' } });
    expect(pickVenue([candidate('Met', 20), candidate('Guggenheim', 400)]).kind).toBe('choose');
  });

  it('asks between venues that are all beyond 150 m but within 400 m', () => {
    expect(pickVenue([candidate('A', 200), candidate('B', 300), candidate('C', 380)]).kind).toBe('choose');
  });

  it('finds nothing for an empty list or a single venue beyond 150 m', () => {
    expect(pickVenue([])).toEqual({ kind: 'none' });
    expect(pickVenue([candidate('Met', 300)])).toEqual({ kind: 'none' });
  });
});

describe('formatDistance', () => {
  it.each([
    [3, '10 m'],
    [124, '120 m'],
    [999, '1000 m'],
    [1000, '1.0 km'],
    [3140, '3.1 km'],
    [Number.NaN, ''],
  ])('formats %s as %s', (meters, text) => {
    expect(formatDistance(meters)).toBe(text);
  });
});
