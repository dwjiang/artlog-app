import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { FlatList, View, useWindowDimensions } from "react-native";

import { ChoiceMenu } from "@/components/choice-menu";
import { SearchEmptyState } from "@/components/empty-state";
import { CollectionEmptyState } from "@/components/guest/collection-empty-state";
import { VisitSkeleton } from "@/components/loading-skeleton";
import { SocialState } from "@/components/social/social-state";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery } from "@/constants/theme";
import { cropSyncing } from "@/lib/account/photo-sync";
import { signInRoute } from "@/lib/account/sign-in-context";
import { artistSections } from "@/lib/collection/artist-sections";
import { filterWorks } from "@/lib/collection/search";
import type { useCollectionData } from "@/lib/collection/use-collection-data";
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
  controls,
  onClearSearch,
  onRetry,
  showCount = true,
}: Pick<ReturnType<typeof useCollectionData>, "works" | "loading" | "error"> & {
  showCount?: boolean;
  search: string;
  header?: ReactElement;
  controls?: ReactElement;
  onClearSearch?: () => void;
  onRetry?: () => void;
}) {
  const wall = useCollectionWall(works);
  const { fontScale, width } = useWindowDimensions();
  const [sort, setSort] = useState<"recent" | "artist">("recent");
  // The hook owns the first read; returning from a detail screen, which edits the wall through its own repository, re-reads it.
  const loaded = useRef(false);
  useEffect(() => {
    loaded.current = !!wall.acknowledged;
  }, [wall.acknowledged]);
  useFocusEffect(
    useCallback(() => {
      if (wall.signedIn && loaded.current) void wall.refresh();
      // oxlint-disable-next-line react-hooks/exhaustive-deps
    }, [wall.repository, wall.signedIn]),
  );
  const filtered = filterWorks(works, search);
  const columns = fontScale > 1.4 ? 1 : 2;
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
  if (controls) {
    rows.push({ key: "controls", kind: "element", element: controls });
  }
  const initialLoading = loading && !error && works.length === 0;
  if (!initialLoading && works.length > 0) {
    rows.push({
      key: "count",
      kind: "element",
      element: (
        <View
          style={{
            paddingHorizontal: 20,
            paddingVertical: 6,
            flexDirection: "row",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 16,
          }}
        >
          <View style={{ flex: 1 }}>
            {showCount && (
              <Text variant="metadata" themeColor="textSecondary">
                {filtered.length} {filtered.length === 1 ? "artwork" : "artworks"}
              </Text>
            )}
          </View>
          <ChoiceMenu
            label="Sort by"
            icon="arrow.up.arrow.down"
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
    <FlatList
      style={{ flex: 1, backgroundColor: Gallery.paper }}
      data={rows}
      keyExtractor={(row) => row.key}
      contentInsetAdjustmentBehavior="automatic"
      automaticallyAdjustKeyboardInsets
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingBottom: 28 }}
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
      stickyHeaderIndices={controls && fontScale < 1.6 ? [header ? 1 : 0] : undefined}
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
            {item.works.map((work) => {
              const hung = wall.draft?.items.some((piece) => piece.saveLocalId === work.localId);
              return (
                <WorkLink key={work.localId} work={work} style={{ width: tileWidth, gap: 8 }}>
                  <View style={{ padding: 12, backgroundColor: Gallery.fill }}>
                    <SavedWorkImage
                      contain
                      path={work.cropPath}
                      syncing={cropSyncing(work)}
                      title={work.title}
                      style={{
                        width: tileWidth - 24,
                        height: tileWidth * 1.18 - 24,
                      }}
                    />
                  </View>
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
            })}
          </View>
        );
      }}
    />
  );
}
