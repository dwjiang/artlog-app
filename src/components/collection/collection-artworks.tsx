import { router, useFocusEffect } from "expo-router";
import { useCallback, useState, type ReactElement } from "react";
import { View, useWindowDimensions } from "react-native";

import { ChoiceMenu } from "@/components/choice-menu";
import { SearchEmptyState } from "@/components/empty-state";
import { CollectionEmptyState } from "@/components/guest/collection-empty-state";
import { VisitSkeleton } from "@/components/loading-skeleton";
import { SafeAreaFlatList } from "@/components/safe-area-scroll";
import { SocialState } from "@/components/social/social-state";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery } from "@/constants/theme";
import type { SavedWork } from "@/db/schema";
import { cropSyncing } from "@/lib/account/photo-sync";
import { signInRoute } from "@/lib/account/sign-in-context";
import { artistSections } from "@/lib/collection/artist-sections";
import { filterWorks } from "@/lib/collection/search";
import type { useCollectionData } from "@/lib/collection/use-collection-data";
import { gridColumns } from "@/lib/ui/grid-columns";
import { useSafeAreaWidth } from "@/lib/ui/safe-area";
import { useCollectionWall } from "@/lib/wall/use-collection-wall";

import { GalleryButton } from "./gallery-button";
import { SavedWorkImage } from "./saved-work-image";
import { WorkLink } from "./work-link";

type Work = ReturnType<typeof useCollectionData>["works"][number];
type Row =
  | { key: string; kind: "element"; element: ReactElement }
  | { key: string; kind: "artist"; title: string }
  | { key: string; kind: "works"; works: Work[] };

export function CollectionArtworks({
  works,
  loading,
  error,
  search,
  header,
  onClearSearch,
  onRetry,
}: Pick<ReturnType<typeof useCollectionData>, "works" | "loading" | "error"> & {
  search: string;
  header?: ReactElement;
  onClearSearch?: () => void;
  onRetry?: () => void;
}) {
  const wall = useCollectionWall(works);
  const { fontScale } = useWindowDimensions();
  const width = useSafeAreaWidth();
  const [sort, setSort] = useState<"recent" | "artist">("recent");
  // The hook owns the first read; returning from a detail screen, which edits the wall through its own repository, re-reads it.
  useFocusEffect(
    useCallback(() => {
      if (wall.repository.getSnapshot().acknowledged) void wall.refresh();
      // oxlint-disable-next-line react-hooks/exhaustive-deps
    }, [wall.repository]),
  );
  const filtered = filterWorks(works, search);
  const columns = gridColumns(2, width, fontScale);
  const tileWidth = Math.max(1, (width - 40 - (columns - 1) * 14) / columns);
  const rows: Row[] = [];
  function addWorks(items: Work[]) {
    for (let index = 0; index < items.length; index += columns) {
      const group = items.slice(index, index + columns);
      rows.push({
        key: `works:${group[0].localId}`,
        kind: "works",
        works: group,
      });
    }
  }
  const initialLoading = loading && !error && works.length === 0;
  if (!initialLoading && works.length > 0) {
    rows.push({
      key: "sort",
      kind: "element",
      element: (
        <View style={{ paddingHorizontal: 20, paddingVertical: 6, flexDirection: "row", justifyContent: "flex-end" }}>
          <ChoiceMenu
            label="Sort by"
            value={sort}
            onChange={setSort}
            options={[
              { value: "recent", label: "Recent" },
              { value: "artist", label: "Artist" },
            ]}
          />
        </View>
      ),
    });
  }
  if (sort === "artist") {
    for (const section of artistSections(filtered)) {
      rows.push({
        key: `artist:${section.key}`,
        kind: "artist",
        title: section.title,
      });
      addWorks(section.data);
    }
  } else {
    addWorks([...filtered].sort((a, b) => b.savedAt - a.savedAt || a.localId.localeCompare(b.localId)));
  }
  const empty = initialLoading ? (
    <VisitSkeleton heading={false} label="Opening collection…" />
  ) : filtered.length > 0 ? undefined : error ? (
    <SocialState
      title="Couldn’t load your collection."
      detail="Your saved collection is still on this iPhone. Try opening it again."
      action={onRetry ? "Try again" : undefined}
      onAction={onRetry}
    />
  ) : search.trim() ? (
    <SearchEmptyState
      title="No artworks found."
      detail="Try another title, artist, or place."
      onClear={() => onClearSearch?.()}
    />
  ) : (
    <CollectionEmptyState kind="artworks" />
  );
  return (
    <SafeAreaFlatList
      style={{ flex: 1, backgroundColor: Gallery.paper }}
      data={rows}
      keyExtractor={(row) => row.key}
      contentInsetAdjustmentBehavior="automatic"
      bounces={!empty}
      automaticallyAdjustKeyboardInsets
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingBottom: empty ? 0 : 28 }}
      ListHeaderComponent={header}
      ListFooterComponent={
        <>
          {empty}
          {!wall.signedIn && works.length > 0 && (
            <View
              style={{
                padding: 20,
                gap: 6,
                borderTopWidth: 0.5,
                borderColor: Gallery.softBorder,
              }}
            >
              <Text style={{ color: Gallery.muted, fontSize: 13 }}>
                Sign in to share your wall and connect with friends.
              </Text>
              <GalleryButton label="Sign in" onPress={() => router.push(signInRoute("wall"))} />
            </View>
          )}
        </>
      }
      renderItem={({ item }) => {
        if (item.kind === "element") return item.element;
        if (item.kind === "artist") {
          return (
            <Text
              variant="section"
              accessibilityRole="header"
              style={{
                paddingHorizontal: 20,
                paddingVertical: 12,
                color: Gallery.ink,
              }}
            >
              {item.title}
            </Text>
          );
        }
        return (
          <View
            style={{
              flexDirection: "row",
              gap: 14,
              paddingHorizontal: 20,
              paddingBottom: 22,
            }}
          >
            {item.works.map((work) => (
              <ArtworkTile
                key={work.localId}
                work={work}
                width={tileWidth}
                hung={!!wall.draft?.items.some((piece) => piece.saveLocalId === work.localId)}
              />
            ))}
          </View>
        );
      }}
    />
  );
}

// Tall photos stop at this height-to-width ratio so one portrait doesn't stretch its row.
const MAX_TILE_RATIO = 1.18;

/** A saved work in a grid: your photo, title and artist, opening the saved page. */
export function ArtworkTile({
  work,
  width,
  hung = false,
}: {
  work: Pick<SavedWork, "localId" | "title" | "artist" | "cropPath" | "cropStorageId">;
  width: number;
  hung?: boolean;
}) {
  const [photo, setPhoto] = useState<{ path: string; aspect: number }>();
  const aspect = photo && photo.path === work.cropPath ? photo.aspect : 1;
  const height = Math.min(width / aspect, width * MAX_TILE_RATIO);
  return (
    <WorkLink work={work} style={{ width, gap: 8 }}>
      <SavedWorkImage
        contain
        path={work.cropPath}
        syncing={cropSyncing(work)}
        title={work.title}
        style={{ width: height * aspect, height }}
        onLoad={(size) => {
          if (work.cropPath) setPhoto({ path: work.cropPath, aspect: size.width / size.height });
        }}
      />
      <View style={{ gap: 2 }}>
        <Text variant="secondary" style={{ fontWeight: "600" }}>
          {work.title}
        </Text>
        <Text variant="metadata" themeColor="textSecondary">
          {work.artist || "Artist unknown"}
        </Text>
        {hung && (
          <Text variant="metadata" themeColor="textSecondary">
            On your wall
          </Text>
        )}
      </View>
    </WorkLink>
  );
}
