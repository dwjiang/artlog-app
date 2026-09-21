import { requireOptionalNativeModule } from 'expo';

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
  /** Museums and art galleries within `radiusMeters`, nearest first, at most eight; coordinates stay on the phone. */
  searchNearby(lat: number, lng: number, radiusMeters: number): Promise<PoiRecord[]>;
  /** Places of any kind matching a typed name, nearest to the origin first when one is given; at most eight. */
  searchByName(query: string, lat?: number, lng?: number): Promise<PoiRecord[]>;
}

let instance: PoiSearch | null | undefined;

export function getPoiSearch(): PoiSearch {
  instance ??= requireOptionalNativeModule<PoiSearch>('PoiSearch');
  if (!instance) throw new Error('The PoiSearch native module is unavailable; rebuild the dev client');
  return instance;
}
