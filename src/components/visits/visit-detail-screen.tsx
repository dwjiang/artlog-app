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
import { Gallery, Spacing, Typography } from "@/constants/theme";
import { selectAllArtworkPhotos } from "@/db/repos/artwork-album";
import { patchVisit } from "@/db/repos/visits";
import { flushJournal } from "@/lib/account/collection-sync";
import { captureOwner, useOwnerGeneration } from "@/lib/account/owner-store";
import { cropSyncing } from "@/lib/account/photo-sync";
import { signInRoute } from "@/lib/account/sign-in-context";
import { formatVisitDate } from "@/lib/journal/history";
import { useVisits } from "@/lib/journal/use-visits";
import { markVisitSeen } from "@/lib/journal/visit-seen";
import type { VisitSummary } from "@/lib/journal/visit-summaries";
import { reportError } from "@/lib/observability";
import { retryAction, showToast } from "@/lib/ui/toast";
import { useVenue } from "@/lib/venue/use-venue";
import { useVisitSharing } from "@/lib/visits/use-visit-sharing";
import type { VisitVisibility } from "@/shared/journal/contracts";

import { VisitActionBar } from "./visit-action-bar";
import { LocalVisitGalleryArtwork, matchesVisitSearch, VisitGallerySearch } from "./visit-gallery";
import { VisitNotes, type VisitNotesHandle } from "./visit-notes";
import { VisitMessage, VisitPage, visitStyles as styles } from "./visit-ui";
import { VisitVisibilityChip } from "./visit-visibility-picker";

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
    return (
      <VisitPage>
        <VisitMessage
          loading={loading && !error}
          skeleton="visit"
          action="Back to Collection"
          onAction={() => router.back()}
        >
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
  // Only a closed visit counts as seen; one viewed while open is still new once it closes on its own.
  useEffect(() => {
    if (visit.endedAt !== null) markVisitSeen(visit.localId, visit.owner);
  }, [visit.localId, visit.owner, visit.endedAt]);
  const [search, setSearch] = useState("");
  const { end } = useVenue();
  const notes = useRef<VisitNotesHandle>(null);
  const [draftVisibility, setDraftVisibility] = useState(visit.visibility);
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const [saveError, setSaveError] = useState<string>();
  const { fontScale } = useWindowDimensions();
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
  const visibility = endingVisit ? draftVisibility : visit.visibility;
  const shared = visibility !== "private";
  const published = sharing.acknowledged?.status === "active";
  const postId = published ? sharing.acknowledged!.postId : null;
  // The status check only decides what this screen offers for a shared visit; sharing itself reports its own errors.
  // A retry clears the error as it starts, so the pill steps aside and returns only if the retry fails too.
  const shareCheckFailed = shared && !sharing.profileRequired && !!sharing.error;
  // An unsynced row only means a pending change once a published version exists that the server still shows to a
  // different audience.
  const pendingChange =
    !endingVisit && signedIn && visit.syncedAt === null && published && sharing.acknowledged?.audience !== visibility;
  const statusNote = changingVisibility
    ? "Updating…"
    : pendingChange || !!visibilityError
      ? "Visibility change pending"
      : endingVisit
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
      !endingVisit && published && next !== "private" && REACH[next] > REACH[visibility]
        ? CONFIRM_WIDER[next]
        : undefined;
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
    if (endingVisit) {
      setDraftVisibility(next);
      return;
    }
    setChangingVisibility(true);
    setVisibilityError(undefined);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await patchVisit(visit.localId, { visibility: next }, visit.owner);
      if (signedIn) {
        await Promise.race([
          flushJournal(),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => reject(new Error("Visibility sync timed out")), 30_000);
          }),
        ]);
        clearTimeout(timeout);
        if (session.isCurrent() && !sharing.profileRequired) {
          await controller.load();
        }
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
      clearTimeout(timeout);
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
  async function copyLink(id: string) {
    try {
      const copied = await setStringAsync(`artlog://visit/${encodeURIComponent(id)}`);
      showToast(copied ? "Visit link copied." : "Couldn’t copy the link. Try again.");
    } catch (cause) {
      reportError(cause, "visit.share.copy-link", { level: "warning" });
      showToast("Couldn’t copy the link. Try again.");
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
      router.setParams({ endVisit: undefined });
      if (shared) {
        openSharing();
      } else {
        showToast("Visit saved.");
        if (router.canGoBack()) router.back();
      }
    } catch (cause) {
      reportError(cause, "visit.save");
      if (session.isCurrent()) setSaveError("Couldn’t save visit. Try again.");
    } finally {
      submitting.current = false;
      if (session.isOwnerCurrent()) setSaving(false);
    }
  }
  const count = visit.works.length;
  return (
    <>
      <Stack.Screen options={{ title: "" }} />
      {(!endingVisit || postId) && (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Menu
            icon="ellipsis"
            accessibilityLabel="Visit options"
            hidesSharedBackground
            tintColor={Gallery.ink}
          >
            {!endingVisit && (
              <Stack.Toolbar.MenuAction
                icon="square.and.arrow.up"
                onPress={() => {
                  void share();
                }}
              >
                {published ? "Edit post" : "Share visit"}
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
                View post
              </Stack.Toolbar.MenuAction>
            )}
            {postId && sharing.acknowledged?.audience !== "private" && (
              <Stack.Toolbar.MenuAction
                icon="link"
                onPress={() => {
                  void copyLink(postId);
                }}
              >
                Copy link
              </Stack.Toolbar.MenuAction>
            )}
          </Stack.Toolbar.Menu>
        </Stack.Toolbar>
      )}
      <View style={styles.page}>
        <View style={{ flex: 1 }}>
          <VisitPage>
            {saveError && (
              <Text accessibilityRole="alert" style={styles.error}>
                {saveError}
              </Text>
            )}
            <View style={{ gap: 6 }}>
              <Text selectable accessibilityRole="header" style={[Typography.display, { color: Gallery.ink }]}>
                {visit.venueName}
              </Text>
              <Text selectable style={styles.caption}>
                {formatVisitDate(visit.visitedOn)}
                {visit.location ? ` · ${visit.location}` : ""}
              </Text>
            </View>
            <View style={{ gap: 8 }}>
              <View style={detail.status}>
                <VisitVisibilityChip
                  value={visibility}
                  disabled={saving || changingVisibility || sharing.busy}
                  onChange={chooseVisibility}
                />
                {statusNote && <Text style={styles.caption}>{statusNote}</Text>}
              </View>
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
            </View>
            <VisitNotes ref={notes} visit={visit} autoSave={!endingVisit} editable={!saving} />
            <View>
              <View style={detail.sectionLabel}>
                <Text accessibilityRole="header" style={styles.eyebrow}>
                  {count > 0 ? `${count} ${count === 1 ? "artwork" : "artworks"}` : "Artworks"}
                </Text>
                {count > 0 && <GalleryButton label="Link artwork" icon="plus" onPress={linkArtwork} />}
              </View>
              {count > 8 && <VisitGallerySearch value={search} onChangeText={setSearch} />}
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  justifyContent: "space-between",
                  columnGap: 13,
                  rowGap: 20,
                  paddingTop: 4,
                }}
              >
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
                        width: fontScale > 1.4 ? "100%" : "48%",
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
                  <SearchEmptyState
                    title="No artworks found."
                    detail="Try an artist or artwork title."
                    onClear={() => setSearch("")}
                  />
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
            <View pointerEvents="box-none" style={detail.toast}>
              <ToastPill
                message="Couldn’t check the shared version."
                actions={[retryAction(() => void controller.load())]}
              />
            </View>
          )}
        </View>
        {endingVisit && (
          <VisitActionBar
            saving={saving}
            disabled={changingVisibility}
            onSave={() => {
              void save();
            }}
          />
        )}
      </View>
    </>
  );
}

const detail = StyleSheet.create({
  status: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 },
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
