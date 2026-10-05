import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { Image } from "expo-image";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { createContext, use, useEffect, useRef, useState } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { useAnimatedRef } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Sortable from "react-native-sortables";

import { GalleryButton } from "@/components/collection/gallery-button";
import { SavedWorkImage } from "@/components/collection/saved-work-image";
import { WallpaperEditor } from "@/components/collection/wallpaper-editor";
import { MotionPressable } from "@/components/motion-pressable";
import { ProfileForm } from "@/components/social/profile-form";
import { ThemedText as Text } from "@/components/themed-text";
import {
  Gallery,
  NavigationTheme,
  PinnedFooterBorder,
  Spacing,
  TransparentHeader,
  Typography,
} from "@/constants/theme";
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

import { ArtBand, type BandArtwork } from "./art-band";
import { ShareArtworkTile } from "./share-artwork-tile";
import { SharePhotoPicker } from "./share-photo-picker";
import { VisitNotes, type VisitNotesHandle } from "./visit-notes";
import { CancelToolbar, CommitToolbar } from "./visit-sheet-toolbar";
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
      <Stack screenOptions={{ ...NavigationTheme, ...TransparentHeader, animation: reduced ? "fade" : "default" }}>
        <Stack.Screen name="index" options={{ title: "Share Visit" }} />
        <Stack.Screen name="photos" options={{ title: "Choose Photos" }} />
      </Stack>
    </ShareContext>
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
/**
 * Saves the notes, then publishes under `audience`. The server publishes a visit only to its own visibility, so the visit
 * takes the audience for the request and gets its previous visibility back if posting fails.
 */
async function publishAs(
  audience: VisitVisibility,
  visit: VisitSummary,
  notes: VisitNotesHandle | null,
  controller: Sharing["controller"],
) {
  if (!(await notes?.save())) return false;
  const previous = visit.visibility;
  const changed = previous !== audience;
  if (changed) await patchVisit(visit.localId, { visibility: audience }, visit.owner);
  if (await controller.publish()) return true;
  if (changed) await patchVisit(visit.localId, { visibility: previous }, visit.owner);
  return false;
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
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const [styling, setStyling] = useState(false);
  const bandTop = useRef(0);
  const [aspects, setAspects] = useState<Record<string, number>>({});
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
        <CancelToolbar onPress={() => router.dismiss()} />
        <Text style={styles.body}>Create a profile to publish this visit.</Text>
        <GalleryButton label="Create profile" variant="filled" onPress={() => setCreatingProfile(true)} />
      </VisitPage>
    );
  }
  if (!draft) {
    return (
      <VisitPage>
        <CancelToolbar onPress={() => router.dismiss()} />
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
  const visitPhotos = (saveLocalId: string) =>
    photos.data.filter(
      (row) =>
        row.owner === visit.owner
        && row.savedLocalId === saveLocalId
        && row.visitLocalId === visit.localId
        && row.deletedAt === null,
    );
  function sharedPhotos(saveLocalId: string) {
    const available = visitPhotos(saveLocalId);
    const selectedIds = draft!.photoSelections?.find((row) => row.saveLocalId === saveLocalId)?.photoLocalIds ?? [];
    return selectedIds.flatMap((localId) => available.find((row) => row.localId === localId) ?? []);
  }
  // An included artwork shows only a photo chosen for sharing; one left out shows the photo including it would add.
  function tilePhotoPath(saveLocalId: string, isIncluded: boolean) {
    if (!isIncluded) return visitPhotos(saveLocalId).find((photo) => photo.kind !== "label")?.path ?? null;
    return sharedPhotos(saveLocalId)[0]?.path ?? null;
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
  // No try/finally here: the React Compiler skips a component that has one, and would leave the toolbar unmemoized.
  async function post() {
    if (submitting.current) return;
    submitting.current = true;
    setPosting(true);
    setPostError(undefined);
    const { audience } = draft!;
    const posted = await publishAs(audience, visit, notes.current, controller).catch((cause: unknown) => {
      reportError(cause, "visit.publish.visibility");
      setPostError("Your visit could not be posted. Your selection is kept. Try again.");
      return false;
    });
    if (posted) {
      // Home opens on the feed the post belongs to; feeds order posts by visit date, not by when they were posted.
      showToast(POSTED[audience]);
      router.dismissAll();
      router.navigate({
        pathname: "/",
        params: { feed: audience === "public" ? "global" : "friends", posted: String(Date.now()) },
      });
      if (audience !== "private") offerNotifications();
    }
    submitting.current = false;
    setPosting(false);
  }
  const band = [...ranks.keys()].flatMap((id): BandArtwork[] => {
    const work = worksById.get(id);
    if (!work) return [];
    const shared = sharedPhotos(id);
    const path = shared[0]?.path ?? null;
    return [
      {
        key: id,
        title: work.title,
        artist: work.artist,
        aspect: path ? aspects[path] : undefined,
        photoCount: shared.length,
        renderImage: (size) => (
          <SavedWorkImage
            contain
            path={path}
            title={work.title}
            style={size}
            onLoad={(image) => {
              if (path) setAspects((known) => ({ ...known, [path]: image.width / image.height }));
            }}
          />
        ),
      },
    ];
  });
  /** Opens the wall's wallpaper picker with the band scrolled up into view above it. */
  function openStyle() {
    setStyling(true);
    scrollRef.current?.scrollTo({ y: bandTop.current - headerHeight, animated: !reduced });
  }
  const columns = fontScale > 1.4 ? 1 : 2;
  const tileSize = (width - 2 * GUTTER - (columns - 1) * TILE_GAP) / columns;
  const postLabel = acknowledged?.status === "active" ? "Update" : "Post";
  const tile = (work: VisitSummary["works"][number]) => {
    const position = ranks.get(work.localId);
    return (
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
  };
  return (
    <GestureHandlerRootView style={share.page}>
      <CancelToolbar disabled={posting} onPress={() => router.dismiss()} />
      <CommitToolbar
        label={styling ? "Done" : postLabel}
        busyLabel="Posting"
        busy={posting}
        disabled={!styling && (sharing.busy || acknowledged?.removed)}
        onPress={() => {
          if (styling) setStyling(false);
          else void post();
        }}
      />
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
        {!acknowledged?.removed && band.length > 0 && (
          <View style={share.band} onLayout={(event) => (bandTop.current = event.nativeEvent.layout.y)}>
            <ArtBand
              wallpaper={draft}
              artworks={band}
              accessory={
                !styling && (
                  <MotionPressable
                    accessibilityRole="button"
                    accessibilityLabel="Style wallpaper"
                    disabled={sharing.busy}
                    hitSlop={6}
                    onPress={openStyle}
                    style={share.style}
                  >
                    <Image source="sf:paintpalette" tintColor={Gallery.ink} style={{ width: 16, height: 16 }} />
                    <Text style={share.styleLabel}>Style</Text>
                  </MotionPressable>
                )
              }
            />
          </View>
        )}
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
      {styling && (
        <View style={[share.tray, { paddingBottom: insets.bottom }]}>
          <WallpaperEditor
            value={{ color: draft.color, pattern: draft.pattern }}
            onChange={({ color, pattern }) => controller.edit({ color, pattern })}
          />
        </View>
      )}
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
  band: { marginHorizontal: -GUTTER, marginBottom: 20 },
  style: {
    position: "absolute",
    top: Spacing.compact,
    right: Spacing.compact,
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 13,
    borderRadius: 18,
    backgroundColor: Gallery.paper,
    boxShadow: "0 3px 12px rgba(0,0,0,0.14)",
  },
  styleLabel: { fontSize: 14, lineHeight: 18, fontWeight: "600", color: Gallery.ink },
  tray: { backgroundColor: Gallery.paper, ...PinnedFooterBorder },
});
