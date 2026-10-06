import { useLocalSearchParams } from "expo-router";

import { ArtworkResultsScreen } from "@/components/catalog/artwork-results-screen";
import { useRecentSearches } from "@/lib/social/recent-searches";

export default function SearchArtworksRoute() {
  const { query } = useLocalSearchParams<{ query: string }>();
  const { remember } = useRecentSearches();
  return (
    <ArtworkResultsScreen
      query={query}
      onOpen={({ artworkId, title, thumbnailUrl }) =>
        remember({ kind: "artwork", artwork: { artworkId, title, thumbnailUrl } })
      }
    />
  );
}
