import { useState } from "react";
import { View } from "react-native";

import { SearchField } from "@/components/search-field";
import { ThemedText } from "@/components/themed-text";
import { useCollectionData } from "@/lib/collection/use-collection-data";

import { CollectionArtworks } from "./collection-artworks";

export function AllArtworksScreen() {
  const [attempt, setAttempt] = useState(0);
  return <AllArtworks key={attempt} onRetry={() => setAttempt((value) => value + 1)} />;
}

function AllArtworks({ onRetry }: { onRetry: () => void }) {
  const data = useCollectionData();
  const [search, setSearch] = useState("");
  return (
    <CollectionArtworks
      {...data}
      search={search}
      onClearSearch={() => setSearch("")}
      onRetry={onRetry}
      header={
        <View style={{ paddingHorizontal: 20, paddingTop: 4, gap: 12 }}>
          <ThemedText variant="metadata" themeColor="textSecondary">
            {data.works.length} {data.works.length === 1 ? "artwork" : "artworks"}
          </ThemedText>
          <SearchField
            label="Search artworks"
            placeholder="Title, artist, date or place"
            showLabel={false}
            value={search}
            onChange={setSearch}
            onClear={() => setSearch("")}
          />
        </View>
      }
    />
  );
}
