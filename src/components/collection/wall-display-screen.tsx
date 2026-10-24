import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";

import { LoadingRing } from "@/components/loading-ring";
import { FormSkeleton } from "@/components/loading-skeleton";
import { SafeAreaScrollView } from "@/components/safe-area-scroll";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery } from "@/constants/theme";
import { selectSavedWork } from "@/db/repos/saved-works";
import type { SavedWork } from "@/db/schema";
import { useScrollTitle } from "@/hooks/use-scroll-title";
import { useLocalOwner } from "@/lib/account/owner-store";
import { reportError } from "@/lib/observability";
import { useSafeAreaWidth } from "@/lib/ui/safe-area";
import { useCollectionWall } from "@/lib/wall/use-collection-wall";
import { constrainLayout, wallAspect, type WallFrame } from "@/lib/wall/wall-layout";
import { WALL_FRAMES as wallFrames } from "@/shared/wall/frames";

import { ArtworkQueryState } from "./artwork-query-state";
import { GalleryButton } from "./gallery-button";
import { PhotoVisibility } from "./photo-visibility";
import { WallArtwork } from "./wall-artwork";
import { WallFramePicker } from "./wall-options";
import { WallPhotoPicker } from "./wall-photo-picker";
import { wallpaperStyle } from "./wallpaper";

export function WallDisplayScreen({ savedId }: { savedId: string }) {
  const owner = useLocalOwner();
  const [attempt, setAttempt] = useState(0);
  return (
    <WallDisplayQuery
      key={`${owner}:${savedId}:${attempt}`}
      owner={owner}
      savedId={savedId}
      onRetry={() => setAttempt((value) => value + 1)}
    />
  );
}

function WallDisplayQuery({ owner, savedId, onRetry }: { owner: string; savedId: string; onRetry: () => void }) {
  const { data, error, updatedAt } = useLiveQuery(selectSavedWork(savedId, owner), [savedId, owner]);
  useEffect(() => {
    if (error) reportError(error, "collection.artwork.load");
  }, [error]);
  const work = data.find((row) => row.owner === owner && row.localId === savedId && row.deletedAt === null);
  return work ? (
    <WallDisplay work={work} />
  ) : (
    <ArtworkQueryState item="Artwork" loading={!updatedAt} error={error} onRetry={onRetry} />
  );
}

/** Everything about how one hung artwork appears on the wall: its frame and the photo shown. */
function WallDisplay({ work }: { work: SavedWork }) {
  const width = useSafeAreaWidth();
  const { onHeadingLayout, onScroll } = useScrollTitle(work.title);
  const wall = useCollectionWall([work]);
  const hung = wall.draft?.items.find((item) => item.saveLocalId === work.localId);
  const piece = wall.pieces.find((item) => item.localId === hung?.placementId);
  async function saveLayout() {
    wall.setError(undefined);
    try {
      await wall.repository.publishLayout();
    } catch (cause) {
      reportError(cause, "wall.layout.publish");
      wall.setError("Your wall change was not saved. Tap Retry to save these changes.");
    }
  }
  function change(patch: { frame?: WallFrame; photoLocalId?: string }) {
    if (!wall.draft || !hung || wall.pending) return;
    const { photoLocalId, ...layout } = patch;
    wall.repository.setLayoutDraft({
      ...wall.draft,
      items: wall.draft.items.map((item) =>
        item.placementId === hung.placementId
          ? {
              ...item,
              ...(photoLocalId ? { photoLocalId } : {}),
              layout: constrainLayout(item.layout, layout),
            }
          : item,
      ),
    });
    void saveLayout();
  }
  return (
    <SafeAreaScrollView
      style={{ flex: 1, backgroundColor: Gallery.paper }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
      scrollEnabled={!!wall.draft || !wall.loading}
      onScroll={onScroll}
    >
      {!wall.draft ? (
        <>
          {wall.loading ? (
            <FormSkeleton label="Opening your wall…" />
          ) : (
            <Text style={styles.caption}>Your wall is unavailable right now.</Text>
          )}
        </>
      ) : !hung ? (
        <>
          <Text variant="pageTitle" accessibilityRole="header" onLayout={onHeadingLayout}>
            {work.title}
          </Text>
          <Text style={styles.caption}>This artwork is not on your wall.</Text>
        </>
      ) : (
        <>
          {piece && (
            <View
              accessible
              accessibilityRole="image"
              accessibilityLabel={`${work.title}, ${wallFrames.find((frame) => frame.value === hung.layout.frame)?.name} frame preview`}
              style={[styles.preview, wallpaperStyle(wall.draft)]}
            >
              <WallArtwork piece={piece} width={Math.min(width - 88, 188 * wallAspect(piece))} />
            </View>
          )}
          <Text
            variant="pageTitle"
            accessibilityRole="header"
            numberOfLines={2}
            adjustsFontSizeToFit
            minimumFontScale={0.6}
            style={{ color: Gallery.ink }}
            onLayout={onHeadingLayout}
          >
            {work.title}
          </Text>
          <View style={styles.section}>
            <Text style={styles.label}>Frame</Text>
            <WallFramePicker
              piece={piece}
              value={hung.layout.frame}
              disabled={wall.pending}
              onChange={(frame) => change({ frame })}
            />
          </View>
          <View style={styles.section}>
            <Text style={styles.label}>Wall photo</Text>
            <View pointerEvents={wall.pending ? "none" : "auto"}>
              <WallPhotoPicker
                compact
                savedId={work.localId}
                selectedId={hung.photoLocalId}
                onSelect={(photoLocalId) => change({ photoLocalId })}
              />
            </View>
            <Text style={styles.caption}>Only the selected photo appears on your wall.</Text>
            {hung.photoLocalId && <PhotoVisibility savedId={work.localId} photoId={hung.photoLocalId} />}
          </View>
        </>
      )}
      {wall.error && (
        <View style={{ gap: 8 }}>
          <Text accessibilityRole="alert" style={{ color: Gallery.destructive }}>
            {wall.error}
          </Text>
          <GalleryButton
            label="Retry"
            disabled={wall.pending}
            onPress={() => {
              if (wall.layoutDraft) void saveLayout();
              else void wall.refresh();
            }}
          />
        </View>
      )}
      {wall.pending && <LoadingRing accessibilityLabel="Saving wall changes…" />}
      {hung && !wall.pending && !wall.error && <Text style={styles.caption}>Changes save automatically.</Text>}
    </SafeAreaScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingVertical: 4, gap: 12 },
  section: { gap: 8 },
  preview: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  label: { fontSize: 16, fontWeight: "600", color: Gallery.ink },
  caption: { fontSize: 13, lineHeight: 18, color: Gallery.muted },
});
