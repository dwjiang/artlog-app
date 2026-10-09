import type { AvatarId } from "@/shared/social/avatars";

export type ExploreFriend = { profileId: string; name: string; avatar: AvatarId };

export type ExploreMuseum = {
  id: string;
  name: string;
  city?: string;
  lat: number;
  lng: number;
  /** From the phone's last location fix; unknown without one. */
  distanceM?: number;
  /** `distanceM` in the person's units, such as "1.2 mi". */
  distance?: string;
};

export type Exhibition = {
  id: string;
  title: string;
  museumId: string;
  /**
   * Calendar dates (YYYY-MM-DD) in the museum's time zone; both days are included. A show the museum lists only with
   * its closing date has no `startsOn`.
   */
  startsOn?: string;
  endsOn: string;
  /** The museum's own page for the show. */
  sourceUrl: string;
  /** The page's link-preview image, when it has one. */
  image?: { uri: string; label: string };
  /** Friends who want to see it, most recent first. */
  friends: ExploreFriend[];
};

export type ExploreCity = { id: string; name: string };

export type ExploreCatalog = {
  /** The calendar date (YYYY-MM-DD) the timings are measured from. */
  today: string;
  exhibitions: Exhibition[];
  museums: ExploreMuseum[];
};

export type ExploreData = ExploreCatalog & { city: ExploreCity; cities: ExploreCity[] };
