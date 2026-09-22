import type { Id } from '../../../convex/_generated/dataModel';
import type { MeasurementUnits } from '@/lib/settings/measurement-units';

/** A single seeded row this close is the venue. */
export const AUTO_RADIUS_M = 150;
/** Rows within this distance compete for the "Looks like you're at…" sheet. */
export const CHOOSE_RADIUS_M = 400;
const EARTH_RADIUS_M = 6_371_000;

export type Coordinate = { lat: number; lng: number };

/** One row of the bundled `venues` table. */
export type VenueRow = {
  id: Id<'museums'>;
  key: string;
  name: string;
  lat: number;
  lng: number;
  website: string | null;
  region: string;
  city?: string | null;
  cityKey?: string | null;
  country?: string | null;
};

export type VenueCandidate = VenueRow & { distanceM: number };

export type VenueResolution =
  | { kind: 'auto'; venue: VenueCandidate; options: VenueCandidate[] }
  | { kind: 'choose'; options: VenueCandidate[] }
  | { kind: 'none' };

export function haversineMeters(a: Coordinate, b: Coordinate): number {
  const rad = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(Math.min(1, h)));
}

export type BoundingBox = { minLat: number; maxLat: number; minLng: number; maxLng: number };

/** A latitude/longitude box that contains every point within `radiusM`; callers filter by exact distance. */
export function boundingBox({ lat, lng }: Coordinate, radiusM: number): BoundingBox {
  const latDelta = radiusM / 111_000;
  const lngDelta = radiusM / (111_000 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));
  return {
    minLat: Math.max(-90, lat - latDelta),
    maxLat: Math.min(90, lat + latDelta),
    minLng: Math.max(-180, lng - lngDelta),
    maxLng: Math.min(180, lng + lngDelta),
  };
}

/** Rows within `radiusM` of `origin`, nearest first. */
export function rankCandidates(rows: VenueRow[], origin: Coordinate, radiusM: number): VenueCandidate[] {
  return rows
    .map((row) => ({ ...row, distanceM: haversineMeters(origin, row) }))
    .filter((row) => row.distanceM <= radiusM)
    .sort((a, b) => a.distanceM - b.distanceM);
}

/**
 * `auto` when one venue is within 150 m and no other seeded venue is within 400 m; `choose` when two
 * or more are within 400 m, or when the only one is 150 to 400 m away and needs a "still here?";
 * `none` when nothing seeded is within 400 m. `candidates` must be the rows within 400 m, nearest first.
 */
export function pickVenue(candidates: VenueCandidate[]): VenueResolution {
  const options = candidates.filter((row) => row.distanceM <= CHOOSE_RADIUS_M);
  if (options.length >= 2) return { kind: 'choose', options };
  const [nearest] = options;
  if (!nearest) return { kind: 'none' };
  if (nearest.distanceM <= AUTO_RADIUS_M) return { kind: 'auto', venue: nearest, options };
  return { kind: 'choose', options };
}

export function formatDistance(distanceM: number, units: MeasurementUnits = 'metric'): string {
  if (!Number.isFinite(distanceM)) return '';
  if (units === 'imperial') {
    if (distanceM < 1609.344) return `${Math.max(10, Math.round(distanceM / 0.3048 / 10) * 10)} ft`;
    return `${(distanceM / 1609.344).toFixed(1)} mi`;
  }
  if (distanceM < 1000) return `${Math.max(10, Math.round(distanceM / 10) * 10)} m`;
  return `${(distanceM / 1000).toFixed(1)} km`;
}
