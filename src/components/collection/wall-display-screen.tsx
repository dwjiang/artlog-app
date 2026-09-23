import { reportError } from "@/lib/observability";
import { LoadingRing } from "@/components/loading-ring";
import { FormSkeleton } from "@/components/loading-skeleton";
import { ThemedText as Text } from "@/components/themed-text";
import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { Gallery } from "@/constants/theme";
import { useLocalOwner } from "@/lib/account/owner-store";
import { selectSavedWork } from "@/db/repos/saved-works";
import type { SavedWork } from "@/db/schema";
import { useCollectionWall } from "@/lib/wall/use-collection-wall";
import { constrainLayout, wallAspect, type WallFrame } from "@/lib/wall/wall-layout";
import { WallArtwork } from "./wall-artwork";
import { wallFrames } from "./wall-frame";
import { ArtworkQueryState } from "./artwork-query-state";
import { GalleryButton } from "./gallery-button";
import { NoteVisibility } from "./note-visibility";
import { PhotoVisibility } from "./photo-visibility";
import { WallFramePicker } from "./wall-options";
import { WallPhotoPicker } from "./wall-photo-picker";

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

function WallDisplayQuery({
  owner,
  savedId,
  onRetry,
}: {
  owner: string;
  savedId: string;
  onRetry: () => void;
}) {
  const { data, error, updatedAt } = useLiveQuery(selectSavedWork(savedId, owner), [
    savedId,
    owner,
  ]);
  useEffect(() => {
    if (error) reportError(error, "collection.artwork.load");
  }, [error]);
  const work = data.find(
    (row) => row.owner === owner && row.localId === savedId && row.deletedAt === null,
  );
  return work ? (
    <WallDisplay work={work} />
  ) : (
    <ArtworkQueryState item="Artwork" loading={!updatedAt} error={error} onRetry={onRetry} />
  );
}

/** Everything about how one hung artwork appears on the public wall: frame, the photo shown, and the note. */
function WallDisplay({ work }: { work: SavedWork }) {
  const { width } = useWindowDimensions();
  const wall = useCollectionWall([work]);
  const hung = wall.draft?.items.find((item) => item.saveLocalId === work.localId);
  const published = wall.acknowledged?.items.find((item) => item.saveLocalId === work.localId);
  const piece = wall.pieces.find((item) => item.localId === hung?.placementId);
  // The hook owns the first read; a later sync can change note eligibility, so it re-reads the loaded wall.
  useEffect(() => {
    if (wall.signedIn && work.syncedAt && wall.acknowledged) void wall.refresh();
  }, [wall.repository, work.syncedAt, wall.signedIn]); // oxlint-disable-line react-hooks/exhaustive-deps
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
  async function shareNote(value: boolean) {
    if (!published || wall.pending) return;
    wall.setError(undefined);
    try {
      wall.repository.setNoteDraft([{ itemId: published.itemId, visible: value }]);
      await wall.repository.publishNotes();
    } catch (cause) {
      reportError(cause, "wall.notes.publish");
      wall.setError(
        "This note could not be shared. Refresh to review the latest synced note and try again.",
      );
    }
  }
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: Gallery.paper }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
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
          <Text variant="pageTitle" accessibilityRole="header">
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
              style={[styles.preview, { backgroundColor: wall.draft.color }]}
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
            {hung.photoLocalId && (
              <PhotoVisibility savedId={work.localId} photoId={hung.photoLocalId} />
            )}
          </View>
          <View style={styles.section}>
            <NoteVisibility
              visible={published?.noteVisible ?? false}
              disabled={wall.pending || !published?.noteEligible}
              onChange={(value) => {
                void shareNote(value);
              }}
            />
            {!published?.noteEligible && (
              <Text style={styles.caption}>Add a note and let it sync before sharing it.</Text>
            )}
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
      {hung && !wall.pending && !wall.error && (
        <Text style={styles.caption}>Changes save automatically.</Text>
      )}
    </ScrollView>
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
