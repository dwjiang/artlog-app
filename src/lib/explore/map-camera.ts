import type { CameraPosition } from "expo-maps";

import { haversineMeters } from "@/lib/venue/resolve";

import type { ExploreMuseum } from "./types";

// Measured on an iPhone 17 Pro: a full-screen map at zoom 11 spans about 0.32 degrees of latitude.
const SPAN_AT_ZOOM_11 = 0.32;
const BAR = 0.12;
const FRAMED = 10;
const FRAME_RADIUS_M = 50_000;

/** Opens around the leading museum: nearest the phone, or the first listing shows without a fix. */
export function museumMapCamera(museums: ExploreMuseum[], share: number): CameraPosition | undefined {
  const anchor = museums[0];
  if (!anchor) return undefined;
  // Alphabetical order and country membership do not imply geographic proximity.
  const framed = museums
    .map((museum) => ({ museum, distance: haversineMeters(anchor, museum) }))
    .filter(({ distance }) => distance <= FRAME_RADIUS_M)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, FRAMED)
    .map(({ museum }) => museum);
  const lats = framed.map((museum) => museum.lat);
  const lngs = framed.map((museum) => museum.lng);
  const north = Math.max(...lats);
  const span = north - Math.min(...lats);
  // Labels hang below their pins, so the southern edge keeps more room.
  const above = span * 0.1;
  const below = span * 0.3;
  const bar = BAR / share;
  const mapSpan = Math.max(0.03, (span + above + below) / (1 - bar));
  return {
    coordinates: {
      latitude: north + above + mapSpan * bar - mapSpan / 2,
      longitude: (Math.min(...lngs) + Math.max(...lngs)) / 2,
    },
    zoom: 11 + Math.log2((SPAN_AT_ZOOM_11 * share) / mapSpan),
  };
}
