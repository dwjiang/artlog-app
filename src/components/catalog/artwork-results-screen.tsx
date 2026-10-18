import { ScrollView, StyleSheet, View } from "react-native";

import { SearchEmptyState } from "@/components/empty-state";
import { loadingFirstPage, PageFooter, SocialState } from "@/components/social/social-state";
import { Gallery, Spacing } from "@/constants/theme";
import { useCatalogReady } from "@/lib/catalog/use-catalog-ready";
import { useSavedCatalogWorks } from "@/lib/catalog/use-saved-catalog-works";
import { useCursorPages } from "@/lib/social/use-social-query";

import { api } from "../../../convex/_generated/api";
import { CatalogArtworkRow, type CatalogArtwork } from "./catalog-rows";

const resultsPage = (result: { page: CatalogArtwork[]; cursor: string | null; isDone: boolean }) => result;
const workId = (work: CatalogArtwork) => work.artworkId;

/** Every catalog work matching a search, from Search's “See all”. */
export function ArtworkResultsScreen({ query, onOpen }: { query: string; onOpen?: (work: CatalogArtwork) => void }) {
  const catalog = useCatalogReady();
  const results = useCursorPages(
    api.artworks.search,
    catalog.ready ? { query } : "skip",
    catalog.scope,
    resultsPage,
    workId,
  );
  const saved = useSavedCatalogWorks();
  const offline = !catalog.ready && catalog.offline;
  const empty = results.done && results.items.length === 0;
  return (
    <ScrollView
      style={styles.page}
      contentInsetAdjustmentBehavior="automatic"
      bounces={!offline && !empty}
      scrollEnabled={!loadingFirstPage(results, results.items.length)}
      contentContainerStyle={[styles.content, (offline || empty) && { paddingBottom: 0 }]}
    >
      {offline ? (
        <SocialState title="You’re offline." detail="Connect to search artworks." icon="wifi.slash" />
      ) : empty ? (
        <SearchEmptyState detail="Try another title or artist." />
      ) : (
        <View style={styles.rows}>
          {results.items.map((work, index) => (
            <CatalogArtworkRow
              key={work.artworkId}
              artwork={work}
              saved={saved.get(work.artworkId)}
              query={query}
              first={index === 0}
              last={index === results.items.length - 1}
              onOpen={() => onOpen?.(work)}
            />
          ))}
        </View>
      )}
      <PageFooter
        loading={results.loading}
        error={results.error}
        done={results.done}
        count={results.items.length}
        loadMore={results.loadMore}
        refresh={results.refresh}
        canLoadMore={results.canLoadMore}
        noun="artworks"
        skeleton="card"
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: Gallery.groupedBackground },
  content: { paddingTop: Spacing.two, paddingBottom: Spacing.five },
  rows: { paddingHorizontal: Spacing.content },
});
