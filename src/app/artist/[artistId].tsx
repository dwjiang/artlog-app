import { useLocalSearchParams } from "expo-router";

import { ArtistScreen } from "@/components/catalog/artist-screen";

import type { Id } from "../../../convex/_generated/dataModel";

export default function ArtistRoute() {
  const { artistId } = useLocalSearchParams<{ artistId: Id<"artists"> }>();
  return <ArtistScreen key={artistId} artistId={artistId} />;
}
