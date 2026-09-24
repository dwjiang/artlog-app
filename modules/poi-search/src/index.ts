import { requireOptionalNativeModule } from "expo";

export type PoiRecord = {
  name: string;
  lat: number;
  lng: number;
  website?: string;
  city?: string;
  country?: string;
  /** MapKit's category without its prefix (`museum`, `landmark`, …) or `unknown`. */
  category: string;
  /** Distance from the search origin; absent when the search had none. */
  distanceMeters?: number;
};

export interface PoiSearch {
  /** Museums and art galleries within `radiusMeters`, nearest first, at most eight; sends the search center to Apple Maps. */
  searchNearby(lat: number, lng: number, radiusMeters: number): Promise<PoiRecord[]>;
  /** Sends the query and any origin to Apple Maps; at most eight places, nearest to the origin first when given. */
  searchByName(query: string, lat?: number, lng?: number): Promise<PoiRecord[]>;
}

let instance: PoiSearch | null | undefined;

export function getPoiSearch(): PoiSearch {
  instance ??= requireOptionalNativeModule<PoiSearch>("PoiSearch");
  if (!instance) {
    throw new Error("The PoiSearch native module is unavailable; rebuild the dev client");
  }
  return instance;
}
