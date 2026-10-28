import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { setStringAsync } from "expo-clipboard";
import { router, Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, StyleSheet, View, useWindowDimensions } from "react-native";

import { GalleryButton } from "@/components/collection/gallery-button";
import { WorkLink } from "@/components/collection/work-link";
import { EmptyState, EmptySymbol, SearchEmptyState } from "@/components/empty-state";
import { ThemedText as Text } from "@/components/themed-text";
import { ToastPill } from "@/components/toast-pill";
import { Gallery, Spacing } from "@/constants/theme";
import { selectAllArtworkPhotos } from "@/db/repos/artwork-album";
import { patchVisit } from "@/db/repos/visits";
import { captureOwner, useOwnerGeneration } from "@/lib/account/owner-store";
import { cropSyncing } from "@/lib/account/photo-sync";
import { signInRoute } from "@/lib/account/sign-in-context";
import { useVisits } from "@/lib/journal/use-visits";
import { markVisitSeen } from "@/lib/journal/visit-seen";
import type { VisitSummary } from "@/lib/journal/visit-summaries";
import { saveVisitVisibility } from "@/lib/journal/visit-visibility";
import { reportError } from "@/lib/observability";
import { gridColumns } from "@/lib/ui/grid-columns";
import { playErrorHaptic, playSuccessHaptic } from "@/lib/ui/haptics";
import { useHorizontalSafeAreaPadding, useSafeAreaWidth } from "@/lib/ui/safe-area";
import { retryAction, showErrorToast, showToast } from "@/lib/ui/toast";
import { useVenue } from "@/lib/venue/use-venue";
import { useVisitSharing } from "@/lib/visits/use-visit-sharing";
import type { VisitVisibility } from "@/shared/journal/contracts";

import { VisitActionBar } from "./visit-action-bar";
import { VisitDetailsFields } from "./visit-details-fields";
import { LocalVisitGalleryArtwork, matchesVisitSearch, VisitGallerySearch } from "./visit-gallery";
import { VisitNotes, type VisitNotesHandle } from "./visit-notes";
import { VisitMessage, VisitPage, visitStyles as styles } from "./visit-ui";

const REACH: Record<VisitVisibility, number> = { private: 0, friends: 1, public: 2 };
// Showing a published visit to more people asks first; narrowing who sees it does not.
const CONFIRM_WIDER: Record<"friends" | "public", { title: string; message: string; action: string }> = {
  friends: {
    title: "Share this visit with friends?",
    message: "Your friends will be able to see its shared version.",
    action: "Share with friends",
  },
  public: {
    title: "Make this visit public?",
    message: "Anyone will be able to see its shared version, including people without an account.",
    action: "Make public",
  },
};

export function VisitDetailScreen() {
  const { visitId, endVisit } = useLocalSearchParams<{
    visitId: string;
    endVisit?: string;
  }>();
  const { owner, visits, loading, error } = useVisits();
  const visit = visits.find((row) => row.localId === visitId);
  if (!visit) {
    const opening = loading && !error;
    return (
      <VisitPage style={detail.page} scrollEnabled={!opening}>
        <VisitMessage loading={opening} skeleton="visit" action="Back to Collection" onAction={() => router.back()}>
          {error
            ? "This visit could not load."
            : loading
              ? "Loading visit…"
              : "This visit is unavailable for this account."}
        </VisitMessage>
      </VisitPage>
    );
  }
  return <VisitDetail key={`${owner}:${visitId}:${endVisit}`} visit={visit} endingVisit={endVisit === "true"} />;
}
function VisitDetail({ visit, endingVisit }: { visit: VisitSummary; endingVisit: boolean }) {
  // Only a closed visit counts as seen; one viewed while open is still new once it is ended.
  useEffect(() => {
    if (visit.endedAt !== null) markVisitSeen(visit.localId, visit.owner);
  }, [visit.localId, visit.owner, visit.endedAt]);
  const [search, setSearch] = useState("");
  const { end, move, visit: open } = useVenue();
  // The open visit saves only by ending it, whether opened from the visit band or reviewed for ending, and a
  // visibility change waits for that save.
  const ending = endingVisit || open?.localId === visit.localId;
  // The visit band covers Scan's venue pill, so the open visit carries its way to correct the museum scans match.
  const changeMuseum = open?.localId === visit.localId && !endingVisit;
  const notes = useRef<VisitNotesHandle>(null);
  const [draftVisibility, setDraftVisibility] = useState(visit.visibility);
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const [saveError, setSaveError] = useState<string>();
  const { fontScale } = useWindowDimensions();
  const width = useSafeAreaWidth();
  const [galleryWidth, setGalleryWidth] = useState(width - Spacing.content * 2);
  const toastPadding = useHorizontalSafeAreaPadding();
  const columns = gridColumns(fontScale > 1.15 || galleryWidth < 320 ? 2 : 3, width, fontScale);
  const artworkWidth = (galleryWidth - Spacing.compact * (columns - 1)) / columns;
  const photos = useLiveQuery(selectAllArtworkPhotos(visit.owner), [visit.owner]);
  useEffect(() => {
    if (photos.error) reportError(photos.error, "visit.photos.load");
  }, [photos.error]);
  const filtered = visit.works.filter((work) => matchesVisitSearch(work, search));
  const generation = useOwnerGeneration();
  const sharing = useVisitSharing(
    visit.localId,
    visit.works.map((work) => work.localId),
  );
  const signedIn = visit.owner.startsWith("account:");
  const { controller, token } = sharing;
  useFocusEffect(
    useCallback(() => {
      if (signedIn && token && generation) void controller.load();
    }, [controller, signedIn, token, generation]),
  );
  const [changingVisibility, setChangingVisibility] = useState(false);
  const [visibilityError, setVisibilityError] = useState<{
    next: VisitVisibility;
    message: string;
  }>();
  const visibility = ending ? draftVisibility : visit.visibility;
  const shared = visibility !== "private";
  const published = sharing.acknowledged?.status === "active";
  const postId = published ? sharing.acknowledged!.postId : null;
  // The status check only decides what this screen offers for a shared visit; sharing itself reports its own errors.
  // A retry clears the error as it starts, so the pill steps aside and returns only if the retry fails too.
  const shareCheckFailed = shared && !sharing.profileRequired && !!sharing.error;
  // An unsynced row only means a pending change once a published version exists that the server still shows to a
  // different audience.
  const pendingChange =
    !ending && signedIn && visit.syncedAt === null && published && sharing.acknowledged?.audience !== visibility;
  const statusNote = changingVisibility
    ? "Updating…"
    : pendingChange || !!visibilityError
      ? "Visibility change pending"
      : ending
        ? undefined
        : published
          ? "Posted"
          : sharing.acknowledged
            ? "Not posted yet"
            : undefined;
  const openSharing = () =>
    router.push(
      signedIn
        ? {
            pathname: "/visit-share/[visitId]",
            params: { visitId: visit.localId },
          }
        : signInRoute("visit", visit.localId),
    );
  const linkArtwork = () =>
    router.push({
      pathname: "/link-artwork",
      params: { visitId: visit.localId },
    });
  function chooseVisibility(next: VisitVisibility) {
    if (next === visibility) return;
    const confirmation =
      !ending && published && next !== "private" && REACH[next] > REACH[visibility] ? CONFIRM_WIDER[next] : undefined;
    if (!confirmation) {
      void changeVisibility(next);
      return;
    }
    Alert.alert(confirmation.title, confirmation.message, [
      { text: "Cancel", style: "cancel" },
      {
        text: confirmation.action,
        onPress: () => {
          void changeVisibility(next);
        },
      },
    ]);
  }
  async function changeVisibility(next: VisitVisibility) {
    const session = captureOwner();
    if (session.owner !== visit.owner || changingVisibility) return;
    if (ending) {
      setDraftVisibility(next);
      return;
    }
    setChangingVisibility(true);
    setVisibilityError(undefined);
    try {
      await saveVisitVisibility(visit, next);
      if (signedIn && session.isCurrent() && !sharing.profileRequired) {
        await controller.load();
      }
    } catch (cause) {
      reportError(cause, "visit.visibility.save", {
        data: { visibility: next },
      });
      if (session.isOwnerCurrent()) {
        setVisibilityError({
          next,
          message: signedIn
            ? "Visibility could not sync. A published visit may keep its previous visibility."
            : "Visibility could not save. Try again.",
        });
      }
    } finally {
      if (session.isOwnerCurrent()) setChangingVisibility(false);
    }
  }
  /** Opens the share form once any note still being edited has saved. */
  async function share() {
    const session = captureOwner();
    if (session.owner !== visit.owner || submitting.current) return;
    submitting.current = true;
    try {
      if (!(await notes.current?.save()) || !session.isCurrent()) return;
      openSharing();
    } finally {
      submitting.current = false;
    }
  }
  const [dateError, setDateError] = useState<string>();
  async function changeDate(visitedOn: string) {
    const session = captureOwner();
    if (session.owner !== visit.owner || visitedOn === visit.visitedOn) return;
    setDateError(undefined);
    try {
      await move(visit.localId, {
        venueId: visit.venueId,
        venueName: visit.venueName,
        timeZone: visit.timeZone,
        visitedOn,
      });
    } catch (cause) {
      reportError(cause, "visit.move.date");
      if (session.isOwnerCurrent()) setDateError("The date could not be changed. Try again.");
    }
  }
  async function copyLink(id: string) {
    try {
      const copied = await setStringAsync(`artlog://visit/${encodeURIComponent(id)}`);
      if (copied) showToast("Visit link copied.");
      else showErrorToast("Couldn’t copy the link.", () => void copyLink(id));
    } catch (cause) {
      reportError(cause, "visit.share.copy-link", { level: "warning" });
      showErrorToast("Couldn’t copy the link.", () => void copyLink(id));
    }
  }
  async function save() {
    const session = captureOwner();
    if (session.owner !== visit.owner || submitting.current) return;
    submitting.current = true;
    setSaving(true);
    setSaveError(undefined);
    try {
      if (draftVisibility !== visit.visibility) {
        await patchVisit(visit.localId, { visibility: draftVisibility }, visit.owner);
        if (!session.isCurrent()) return;
      }
      if (!(await notes.current?.save()) || !session.isCurrent()) return;
      await end(visit.localId);
      if (!session.isCurrent()) return;
      playSuccessHaptic();
      router.setParams({ endVisit: undefined });
      if (shared) {
        openSharing();
      } else {
        showToast("Visit saved.");
        if (router.canGoBack()) router.back();
      }
    } catch (cause) {
      reportError(cause, "visit.save");
      if (session.isCurrent()) {
        playErrorHaptic();
        setSaveError("Couldn’t save visit. Try again.");
      }
    } finally {
      submitting.current = false;
      if (session.isOwnerCurrent()) setSaving(false);
    }
  }
  const count = visit.works.length;
  return (
    <>
      {/* Native large-title collapse follows the first descendant; keep the scroll wrappers in the native tree. */}
      <View collapsable={false} style={[styles.page, detail.page]}>
        <View collapsable={false} style={{ flex: 1 }}>
          <VisitPage style={detail.page} contentContainerStyle={detail.content}>
            {saveError && (
              <Text accessibilityRole="alert" style={styles.error}>
                {saveError}
              </Text>
            )}
            <View style={{ gap: Spacing.two }}>
              <VisitDetailsFields
                visit={visit}
                visibility={visibility}
                disabled={saving}
                visibilityDisabled={saving || changingVisibility || sharing.busy}
                onMuseum={() => router.push({ pathname: "/visit-museum", params: { visitId: visit.localId } })}
                onDate={(value) => {
                  void changeDate(value);
                }}
                onVisibility={chooseVisibility}
              />
              {statusNote && <Text style={styles.caption}>{statusNote}</Text>}
              {visibilityError && (
                <View style={{ gap: 4 }}>
                  <Text accessibilityRole="alert" style={styles.error}>
                    {visibilityError.message}
                  </Text>
                  <GalleryButton
                    label="Retry visibility"
                    disabled={changingVisibility}
                    onPress={() => {
                      void changeVisibility(visibilityError.next);
                    }}
                  />
                </View>
              )}
              {dateError && (
                <Text accessibilityRole="alert" style={styles.error}>
                  {dateError}
                </Text>
              )}
            </View>
            {/* A note jotted mid-visit keeps autosaving; only the end-visit review holds it for Save. */}
            <VisitNotes ref={notes} visit={visit} autoSave={!endingVisit} editable={!saving} grouped />
            <View>
              <View style={detail.sectionLabel}>
                <Text accessibilityRole="header" style={detail.sectionTitle}>
                  {count > 0 ? `${count} ${count === 1 ? "artwork" : "artworks"}` : "Artworks"}
                </Text>
                {count > 0 && <GalleryButton label="Link artwork" icon="plus" onPress={linkArtwork} />}
              </View>
              {count > 8 && <VisitGallerySearch value={search} onChangeText={setSearch} />}
              <View onLayout={(event) => setGalleryWidth(event.nativeEvent.layout.width)} style={detail.grid}>
                {filtered.map((work) => {
                  const album = photos.data.filter(
                    (photo) =>
                      photo.owner === visit.owner
                      && photo.savedLocalId === work.localId
                      && photo.visitLocalId === visit.localId,
                  );
                  const cover =
                    album.find((photo) => photo.kind === "full")
                    ?? album.find((photo) => photo.kind !== "label")
                    ?? album[0];
                  return (
                    <WorkLink
                      key={work.localId}
                      work={work}
                      visitId={visit.localId}
                      style={{
                        width: artworkWidth,
                        flexShrink: 1,
                      }}
                    >
                      <LocalVisitGalleryArtwork
                        title={work.title}
                        artist={work.artist}
                        photoCount={album.length}
                        path={cover?.path ?? work.cropPath}
                        syncing={!cover && cropSyncing(work)}
                      />
                    </WorkLink>
                  );
                })}
              </View>
              {filtered.length === 0
                && (search.trim() ? (
                  <SearchEmptyState title="No artworks found." detail="Try an artist or artwork title." />
                ) : (
                  <EmptyState
                    inset={false}
                    title="No artworks linked to this visit."
                    detail="Link a saved artwork to this visit."
                    visual={<EmptySymbol name="photo.on.rectangle" />}
                  >
                    <GalleryButton label="Link artwork" icon="plus" variant="filled" fullWidth onPress={linkArtwork} />
                  </EmptyState>
                ))}
            </View>
          </VisitPage>
          {shareCheckFailed && (
            <View collapsable={false} pointerEvents="box-none" style={[detail.toast, toastPadding]}>
              <ToastPill
                message="Couldn’t check the shared version."
                actions={[retryAction(() => void controller.load())]}
              />
            </View>
          )}
        </View>
        {ending && (
          <VisitActionBar
            saving={saving}
            disabled={changingVisibility}
            onSave={() => {
              void save();
            }}
          />
        )}
      </View>
      {(!ending || postId || changeMuseum) && (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel="Visit options" tintColor={Gallery.ink}>
            {changeMuseum && (
              <Stack.Toolbar.MenuAction
                icon="building.columns"
                onPress={() => router.push({ pathname: "/venue-picker", params: { mode: "change" } })}
              >
                Change Museum…
              </Stack.Toolbar.MenuAction>
            )}
            {!ending && (
              <Stack.Toolbar.MenuAction
                icon="square.and.arrow.up"
                onPress={() => {
                  void share();
                }}
              >
                {published ? "Edit Post…" : "Share Visit…"}
              </Stack.Toolbar.MenuAction>
            )}
            {postId && (
              <Stack.Toolbar.MenuAction
                icon="eye"
                onPress={() =>
                  router.push({
                    pathname: "/visit/[postId]",
                    params: { postId },
                  })
                }
              >
                View Post
              </Stack.Toolbar.MenuAction>
            )}
            {postId && sharing.acknowledged?.audience !== "private" && (
              <Stack.Toolbar.MenuAction
                icon="link"
                onPress={() => {
                  void copyLink(postId);
                }}
              >
                Copy Link
              </Stack.Toolbar.MenuAction>
            )}
          </Stack.Toolbar.Menu>
        </Stack.Toolbar>
      )}
    </>
  );
}

const detail = StyleSheet.create({
  page: { backgroundColor: Gallery.groupedBackground },
  content: { gap: Spacing.three, paddingTop: Spacing.two },
  sectionTitle: { fontSize: 20, lineHeight: 25, fontWeight: "600", color: Gallery.ink },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: Spacing.compact,
    rowGap: Spacing.content,
    paddingTop: Spacing.two,
  },
  sectionLabel: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    paddingTop: 8,
    minHeight: 44,
  },
  toast: {
    position: "absolute",
    left: Spacing.content,
    right: Spacing.content,
    bottom: Spacing.two,
    alignItems: "center",
  },
});
