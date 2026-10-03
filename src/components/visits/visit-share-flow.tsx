import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { createContext, use, useEffect, useRef, useState } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { useAnimatedRef } from "react-native-reanimated";
import Sortable from "react-native-sortables";

import { GalleryButton } from "@/components/collection/gallery-button";
import { ProfileForm } from "@/components/social/profile-form";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, NavigationTheme, Typography } from "@/constants/theme";
import { selectAllArtworkPhotos } from "@/db/repos/artwork-album";
import { patchVisit } from "@/db/repos/visits";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { useOwnerGeneration } from "@/lib/account/owner-store";
import { signInRoute } from "@/lib/account/sign-in-context";
import { formatVisitDate } from "@/lib/journal/history";
import { useVisits } from "@/lib/journal/use-visits";
import type { VisitSummary } from "@/lib/journal/visit-summaries";
import { offerNotifications } from "@/lib/notifications/offer";
import { reportError } from "@/lib/observability";
import { showToast } from "@/lib/ui/toast";
import { arrangeShareGrid, sharedOrder } from "@/lib/visits/share-order";
import { useVisitSharing } from "@/lib/visits/use-visit-sharing";
import type { VisitVisibility } from "@/shared/journal/contracts";
import { LIMITS } from "@/shared/journal/limits";

import { ShareArtworkTile } from "./share-artwork-tile";
import { SharePhotoPicker } from "./share-photo-picker";
import { VisitNotes, type VisitNotesHandle } from "./visit-notes";
import { VisitMessage, VisitPage, visitStyles as styles } from "./visit-ui";
import { VisitVisibilityPicker } from "./visit-visibility-picker";

type Sharing = ReturnType<typeof useVisitSharing>;
const ShareContext = createContext<{ sharing: Sharing; visit: VisitSummary } | null>(null);
function useShareFlow() {
  const value = use(ShareContext);
  if (!value) throw new Error("Visit sharing requires a visit");
  return value;
}
const POSTED: Record<VisitVisibility, string> = {
  private: "Visit posted. Only you can see it.",
  friends: "Shared with friends.",
  public: "Shared with everyone.",
};

export function VisitShareLayout() {
  const { visitId } = useLocalSearchParams<{ visitId: string }>();
  const { owner, visits, loading, error } = useVisits();
  const visit = visits.find((row) => row.localId === visitId);
  if (!visit) {
    return (
      <VisitPage>
        <VisitMessage loading={loading} action="Done" onAction={() => router.dismiss()}>
          {loading
            ? "Loading visit…"
            : error
              ? "This visit could not load."
              : "This visit is unavailable for this account."}
        </VisitMessage>
      </VisitPage>
    );
  }
  return <ShareProvider key={`${owner}:${visitId}`} visit={visit} />;
}
function ShareProvider({ visit }: { visit: VisitSummary }) {
  const reduced = useReducedMotion();
  const { audience } = useLocalSearchParams<{ audience?: string }>();
  const sharing = useVisitSharing(
    visit.localId,
    visit.works.map((work) => work.localId),
    audience === "friends" ? audience : undefined,
  );
  const generation = useOwnerGeneration();
  const { controller, token } = sharing;
  useEffect(() => {
    if (visit.owner.startsWith("account:") && token) void controller.load();
  }, [controller, token, generation, visit.owner]);
  return (
    <ShareContext value={{ sharing, visit }}>
      <Stack screenOptions={{ ...NavigationTheme, animation: reduced ? "fade" : "default" }}>
        <Stack.Screen name="index" options={{ title: "Share visit" }} />
        <Stack.Screen name="photos" options={{ title: "Choose photos", headerBackTitle: "Back" }} />
      </Stack>
    </ShareContext>
  );
}
function CancelToolbar() {
  return (
    <Stack.Toolbar placement="left">
      <Stack.Toolbar.Button tintColor={Gallery.accent} hidesSharedBackground onPress={() => router.dismiss()}>
        Cancel
      </Stack.Toolbar.Button>
    </Stack.Toolbar>
  );
}
function ShareError({ sharing }: { sharing: Sharing }) {
  return sharing.error ? (
    <Text selectable accessibilityRole="alert" style={styles.error}>
      {sharing.error}
    </Text>
  ) : null;
}
function GuestVisitSignIn({ visitId }: { visitId: string }) {
  const { audience } = useLocalSearchParams<{ audience?: string }>();
  useEffect(() => {
    router.replace(signInRoute("visit", visitId, audience === "friends" ? audience : undefined));
  }, [visitId, audience]);
  return (
    <VisitPage>
      <VisitMessage loading>Opening sign-in…</VisitMessage>
    </VisitPage>
  );
}
export function VisitShareScreen() {
  const { sharing, visit } = useShareFlow();
  const [creatingProfile, setCreatingProfile] = useState(false);
  const [layout, setLayout] = useState<string[]>([]);
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string>();
  const submitting = useRef(false);
  const notes = useRef<VisitNotesHandle>(null);
  const { width, fontScale } = useWindowDimensions();
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const photos = useLiveQuery(selectAllArtworkPhotos(visit.owner), [visit.owner]);
  useEffect(() => {
    if (photos.error) reportError(photos.error, "visit.share-photos.load");
  }, [photos.error]);
  const { controller, draft, acknowledged } = sharing;
  if (!visit.owner.startsWith("account:")) {
    return <GuestVisitSignIn visitId={visit.localId} />;
  }
  if (sharing.profileRequired) {
    return creatingProfile ? (
      <ProfileForm
        introduction="Create a profile so people can recognize you. You choose what to share before you post."
        onCreated={() => {
          setCreatingProfile(false);
          void controller.load();
        }}
      />
    ) : (
      <VisitPage>
        <CancelToolbar />
        <Text style={styles.body}>Create a profile to publish this visit.</Text>
        <GalleryButton label="Create profile" variant="filled" onPress={() => setCreatingProfile(true)} />
      </VisitPage>
    );
  }
  if (!draft) {
    return (
      <VisitPage>
        <CancelToolbar />
        <VisitMessage
          loading={sharing.busy || !sharing.error}
          action="Try again"
          onAction={() => {
            void controller.load();
          }}
        >
          {sharing.error ? "Sharing could not load." : "Preparing sharing…"}
        </VisitMessage>
        <ShareError sharing={sharing} />
      </VisitPage>
    );
  }
  const selected = new Set(draft.saveLocalIds);
  const worksById = new Map(visit.works.map((work) => [work.localId, work]));
  const grid = arrangeShareGrid(
    layout,
    draft.saveLocalIds,
    visit.works.map((work) => work.localId),
  );
  const ranks = new Map(sharedOrder(grid, selected).map((id, rank) => [id, rank]));
  const photoTotal = (saveLocalId: string) =>
    photos.data.filter((photo) => photo.savedLocalId === saveLocalId && photo.visitLocalId === visit.localId).length;
  // An included artwork shows only a photo chosen for sharing; one left out shows the photo including it would add.
  function tilePhotoPath(saveLocalId: string, isIncluded: boolean) {
    const visitPhotos = photos.data.filter(
      (row) =>
        row.owner === visit.owner
        && row.savedLocalId === saveLocalId
        && row.visitLocalId === visit.localId
        && row.deletedAt === null,
    );
    if (!isIncluded) return visitPhotos.find((photo) => photo.kind !== "label")?.path ?? null;
    const selectedIds = draft!.photoSelections?.find((row) => row.saveLocalId === saveLocalId)?.photoLocalIds ?? [];
    for (const localId of selectedIds) {
      const photo = visitPhotos.find((row) => row.localId === localId);
      if (photo) return photo.path;
    }
    return null;
  }
  function arrange(next: string[], included: ReadonlySet<string>) {
    setLayout(next);
    controller.edit({ saveLocalIds: sharedOrder(next, included).slice(0, LIMITS.selectedSaves) });
  }
  function toggleSelection(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else if (next.size < LIMITS.selectedSaves) next.add(id);
    else return;
    arrange(grid, next);
  }
  /** Swaps an included artwork with its shared neighbor, the accessible alternative to dragging. */
  function move(id: string, offset: -1 | 1) {
    const order = sharedOrder(grid, selected);
    const from = order.indexOf(id);
    const to = from + offset;
    if (from < 0 || to < 0 || to >= order.length) return;
    const next = [...grid];
    const [a, b] = [next.indexOf(order[from]), next.indexOf(order[to])];
    [next[a], next[b]] = [next[b], next[a]];
    arrange(next, selected);
  }
  async function post() {
    if (submitting.current) return;
    submitting.current = true;
    setPosting(true);
    setPostError(undefined);
    // The server publishes a visit only to its own visibility, so the visit takes the chosen audience for the
    // request and gets its previous visibility back if posting fails.
    const previous = visit.visibility;
    const { audience } = draft!;
    const changed = previous !== audience;
    try {
      if (!(await notes.current?.save())) return;
      if (changed) await patchVisit(visit.localId, { visibility: audience }, visit.owner);
      if (await controller.publish()) {
        // Home opens on the feed the post belongs to; feeds order posts by visit date, not by when they were posted.
        showToast(POSTED[audience]);
        router.dismissAll();
        router.navigate({
          pathname: "/",
          params: { feed: audience === "public" ? "global" : "friends", posted: String(Date.now()) },
        });
        if (audience !== "private") offerNotifications();
        return;
      }
      if (changed) await patchVisit(visit.localId, { visibility: previous }, visit.owner);
    } catch (cause) {
      reportError(cause, "visit.publish.visibility");
      setPostError("Your visit could not be posted. Your selection is kept. Try again.");
    } finally {
      submitting.current = false;
      setPosting(false);
    }
  }
  const columns = fontScale > 1.4 ? 1 : 2;
  const tileSize = (width - 2 * GUTTER - (columns - 1) * TILE_GAP) / columns;
  const active = acknowledged?.status === "active";
  const tile = (work: VisitSummary["works"][number], position = ranks.get(work.localId)) => (
    <ShareArtworkTile
      title={work.title}
      artist={work.artist}
      path={tilePhotoPath(work.localId, position !== undefined)}
      size={tileSize}
      position={position}
      selectable={position !== undefined || selected.size < LIMITS.selectedSaves}
      photos={{
        chosen: draft.photoSelections?.find((row) => row.saveLocalId === work.localId)?.photoLocalIds.length ?? 0,
        total: photoTotal(work.localId),
      }}
      disabled={sharing.busy}
      onToggle={() => toggleSelection(work.localId)}
      onChoosePhotos={() =>
        router.push({
          pathname: "/visit-share/[visitId]/photos",
          params: { visitId: visit.localId, saveId: work.localId },
        })
      }
      onMove={position === undefined ? undefined : (offset) => move(work.localId, offset)}
    />
  );
  return (
    <GestureHandlerRootView style={share.page}>
      <CancelToolbar />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          tintColor={Gallery.accent}
          hidesSharedBackground
          disabled={posting || sharing.busy || acknowledged?.removed}
          onPress={() => {
            void post();
          }}
        >
          {posting ? "Posting…" : active ? "Update" : "Post"}
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
      <Animated.ScrollView
        ref={scrollRef}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="interactive"
        contentContainerStyle={share.content}
      >
        <View style={share.header}>
          <View style={{ gap: 4 }}>
            <Text accessibilityRole="header" style={share.venue}>
              {visit.venueName}
            </Text>
            <Text style={styles.caption}>
              {formatVisitDate(visit.visitedOn)}
              {visit.location ? ` · ${visit.location}` : ""}
            </Text>
          </View>
          {postError && (
            <Text accessibilityRole="alert" style={styles.error}>
              {postError}
            </Text>
          )}
          <ShareError sharing={sharing} />
          {sharing.conflict && (
            <GalleryButton
              label="Refresh sharing status"
              disabled={sharing.busy}
              onPress={() => {
                void controller.load();
              }}
            />
          )}
          <VisitVisibilityPicker
            value={draft.audience}
            disabled={sharing.busy}
            onChange={(audience) => controller.edit({ audience })}
          />
          <VisitNotes ref={notes} visit={visit} autoSave={false} editable={!posting && !sharing.busy} />
          {acknowledged?.removed ? (
            <Text style={styles.error}>This share is no longer available.</Text>
          ) : (
            <View style={share.artworksLabel}>
              <Text accessibilityRole="header" style={styles.eyebrow}>
                Artworks
              </Text>
              <Text style={styles.fine}>
                {visit.works.length === 0
                  ? "You can share a visit with no artworks."
                  : `${selected.size} of ${visit.works.length} · drag to reorder`}
              </Text>
            </View>
          )}
        </View>
        {!acknowledged?.removed && (
          <Sortable.Grid
            data={grid.flatMap((id) => worksById.get(id) ?? [])}
            keyExtractor={(work) => work.localId}
            columns={columns}
            rowGap={ROW_GAP}
            columnGap={TILE_GAP}
            scrollableRef={scrollRef}
            sortEnabled={!sharing.busy}
            hapticsEnabled
            itemEntering={null}
            itemExiting={null}
            onDragEnd={({ data }) =>
              arrange(
                data.map((work) => work.localId),
                selected,
              )
            }
            renderItem={({ item }) => tile(item)}
          />
        )}
      </Animated.ScrollView>
    </GestureHandlerRootView>
  );
}
const GUTTER = 20;
const TILE_GAP = 12;
const ROW_GAP = 22;
export function VisitSharePhotosScreen() {
  const { sharing, visit } = useShareFlow();
  const { saveId } = useLocalSearchParams<{ saveId: string }>();
  const { controller, draft } = sharing;
  const work = visit.works.find((row) => row.localId === saveId);
  if (!work || !draft) {
    return (
      <VisitPage>
        <VisitMessage action="Back" onAction={() => router.back()}>
          This artwork is no longer part of this visit.
        </VisitMessage>
      </VisitPage>
    );
  }
  return (
    <SharePhotoPicker
      work={work}
      visitId={visit.localId}
      selected={draft.photoSelections?.find((row) => row.saveLocalId === work.localId)?.photoLocalIds ?? []}
      onChange={(ids) => {
        controller.edit({
          photoSelections: [
            ...(draft.photoSelections ?? []).filter((row) => row.saveLocalId !== work.localId),
            ...(ids.length > 0 ? [{ saveLocalId: work.localId, photoLocalIds: ids }] : []),
          ],
        });
      }}
    />
  );
}

const share = StyleSheet.create({
  page: { flex: 1, backgroundColor: Gallery.paper },
  content: { paddingHorizontal: GUTTER, paddingTop: 12, paddingBottom: 40 },
  header: { gap: 24, paddingBottom: 12 },
  venue: { ...Typography.display, color: Gallery.ink },
  artworksLabel: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: 8,
  },
});
