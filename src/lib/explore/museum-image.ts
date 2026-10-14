import type { ImageContentPosition } from "expo-image";
import { useNetworkState } from "expo-network";

import { museumCover } from "@/lib/explore/museum-summary";
import type { ExploreCatalog, ExploreMuseum } from "@/lib/explore/types";
import { isOffline } from "@/lib/network-state";
import { useLookAroundStill, type LookAroundStillSize } from "@/lib/venue/look-around-still";
import { useMuseumPhoto, type MuseumPhoto } from "@/lib/venue/use-museum-photo";

export type MuseumImage = {
  uri: string;
  label: string;
  source: { kind: "commons"; photo: MuseumPhoto } | { kind: "look-around" } | { kind: "exhibition" };
  contentPosition?: ImageContentPosition;
};

// iOS draws Apple's Maps logo into each still's lower-left corner; Apple's terms forbid cropping it away.
const APPLE_MAPS_LOGO_CORNER: ImageContentPosition = { left: 0, bottom: 0 };

// Per spot, the smallest of Commons' standard thumbnail widths that stays sharp at 3× once cropped, and the still size
// whose logo stays legible there.
export type MuseumImageSpot = "row" | "card" | "page";
const SPOTS: Record<MuseumImageSpot, { commonsWidth: number; still: LookAroundStillSize }> = {
  row: { commonsWidth: 330, still: "small" },
  card: { commonsWidth: 960, still: "large" },
  page: { commonsWidth: 1280, still: "large" },
};

// The backend links Commons' FilePath redirect with a `width`, which Commons accepts at any of its standard widths.
const atWidth = (imageUrl: string, width: number) => imageUrl.replace(/([?&]width=)\d+/, `$1${width}`);

/**
 * The museum's Commons photo, else a Look Around still from the phone, else the artwork of its most pressing show.
 * `loading` holds while an earlier choice may still arrive.
 */
export function useMuseumImage(
  data: ExploreCatalog | undefined,
  museum: ExploreMuseum | undefined,
  spot: MuseumImageSpot,
): { image?: MuseumImage; loading: boolean } {
  const { commonsWidth, still } = SPOTS[spot];
  const offline = isOffline(useNetworkState());
  const commons = useMuseumPhoto(museum?.id);
  const commonsSettled = commons.settled || offline;
  const lookAround = useLookAroundStill(commonsSettled && !commons.photo ? museum : undefined, still);
  if (!museum) return { loading: false };
  if (commons.photo) {
    const source = { kind: "commons", photo: commons.photo } as const;
    const uri = atWidth(commons.photo.imageUrl, commonsWidth);
    return { image: { uri, label: `Photo of ${museum.name}`, source }, loading: false };
  }
  if (!commonsSettled) return { loading: true };
  if (lookAround.uri) {
    const source = { kind: "look-around" } as const;
    const label = `Look Around view of ${museum.name}`;
    return { image: { uri: lookAround.uri, label, source, contentPosition: APPLE_MAPS_LOGO_CORNER }, loading: false };
  }
  if (!lookAround.settled) return { loading: true };
  const cover = data && museumCover(data, museum);
  return { image: cover && { ...cover, source: { kind: "exhibition" } }, loading: false };
}
