import type { AvatarId } from "@/shared/social/avatars";

export type ExploreFriend = { profileId: string; name: string; avatar: AvatarId };

export type ExploreMuseum = {
  id: string;
  name: string;
  /** A shorter name for tight lines, such as "MCA Chicago". */
  shortName: string;
  lat: number;
  lng: number;
  distanceMiles: number;
  /** Today's opening hours, such as "Open until 5 PM" or "Closed today". */
  hoursToday: string;
  admission?: string;
  photo?: number;
};

export type Exhibition = {
  id: string;
  title: string;
  museumId: string;
  /** Calendar dates (YYYY-MM-DD) in the museum's time zone; both days are included. */
  startsOn: string;
  endsOn: string;
  image: { uri: string; label: string };
  /** Friends who want to see it, most recent first. */
  friends: ExploreFriend[];
};

export type ExploreCity = { id: string; name: string };

export type ExploreData = {
  city: ExploreCity;
  cities: ExploreCity[];
  /** The calendar date (YYYY-MM-DD) the timings are measured from. */
  today: string;
  exhibitions: Exhibition[];
  museums: ExploreMuseum[];
};
