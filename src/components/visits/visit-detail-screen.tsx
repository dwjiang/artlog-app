import { reportError } from "@/lib/observability";
import { EmptyState, EmptySymbol, SearchEmptyState } from "../empty-state";
import { router, Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, StyleSheet, View, useWindowDimensions } from "react-native";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, Typography } from "@/constants/theme";
import { captureOwner, useOwnerGeneration } from "@/lib/account/owner-store";
import { signInRoute } from "@/lib/account/sign-in-context";
import { formatVisitDate } from "@/lib/journal/history";
import { useVisits } from "@/lib/journal/use-visits";
import { markVisitSeen } from "@/lib/journal/visit-seen";
import type { VisitSummary } from "@/lib/journal/visit-summaries";
import { useVisitSharing } from "@/lib/visits/use-visit-sharing";
import { patchVisit } from "@/db/repos/visits";
import { flushJournal } from "@/lib/account/collection-sync";
import { GalleryButton } from "../collection/gallery-button";
import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { selectAllArtworkPhotos } from "@/db/repos/artwork-album";
import { WorkLink } from "../collection/work-link";
import { LocalVisitGalleryArtwork, matchesVisitSearch, VisitGallerySearch } from "./visit-gallery";
import { cropSyncing } from "@/lib/account/photo-sync";
import { useVenue } from "@/lib/venue/use-venue";
import { showToast } from "@/lib/ui/toast";
import { VisitMessage, VisitPage, visitStyles as styles } from "./visit-ui";
import { VisitNotes, type VisitNotesHandle } from "./visit-notes";
import { VisitActionBar } from "./visit-action-bar";

export function VisitDetailScreen() {
  const { visitId, endVisit } = useLocalSearchParams<{ visitId: string; endVisit?: string }>();
  const { owner, visits, loading, error } = useVisits();
  const visit = visits.find((row) => row.localId === visitId);
  if (!visit)
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
  return (
    <VisitDetail
      key={`${owner}:${visitId}:${endVisit}`}
      visit={visit}
      endingVisit={endVisit === "true"}
    />
  );
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
    next: "public" | "private";
    message: string;
  }>();
  const isPublic = (endingVisit ? draftVisibility : visit.visibility) === "public";
  const active = isPublic && sharing.acknowledged?.status === "active";
  // Visits start private, so an unsynced private row only means a pending change once a published version exists.
  const pendingPrivate =
    !endingVisit &&
    signedIn &&
    !isPublic &&
    visit.syncedAt === null &&
    sharing.acknowledged?.status === "active";
  const privacyPending =
    pendingPrivate || visibilityError?.next === "private" || (changingVisibility && isPublic);
  const openSharing = () =>
    router.push(
      signedIn
        ? { pathname: "/visit-share/[visitId]", params: { visitId: visit.localId } }
        : signInRoute("visit", visit.localId),
    );
  async function changeVisibility(next: "public" | "private" = isPublic ? "private" : "public") {
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
        if (session.isCurrent() && !sharing.profileRequired) await controller.load();
      }
    } catch (cause) {
      reportError(cause, "visit.visibility.save", { data: { visibility: next } });
      if (session.isOwnerCurrent())
        setVisibilityError({
          next,
          message: signedIn
            ? "Visibility could not sync. A published visit may still be visible."
            : "Visibility could not save. Try again.",
        });
    } finally {
      clearTimeout(timeout);
      if (session.isOwnerCurrent()) setChangingVisibility(false);
    }
  }
  async function save() {
    const session = captureOwner();
    if (session.owner !== visit.owner || submitting.current) return;
    submitting.current = true;
    setSaving(true);
    setSaveError(undefined);
    try {
      if (endingVisit && draftVisibility !== visit.visibility) {
        await patchVisit(visit.localId, { visibility: draftVisibility }, visit.owner);
        if (!session.isCurrent()) return;
      }
      if (!(await notes.current?.save()) || !session.isCurrent()) return;
      if (endingVisit) {
        await end(visit.localId);
        if (!session.isCurrent()) return;
        router.setParams({ endVisit: undefined });
      }
      if (isPublic) openSharing();
      else {
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
  return (
    <>
      <Stack.Screen options={{ title: "" }} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu
          icon="ellipsis"
          accessibilityLabel="Visit options"
          hidesSharedBackground
          tintColor={Gallery.ink}
        >
          <Stack.Toolbar.MenuAction
            icon="plus"
            onPress={() =>
              router.push({ pathname: "/link-artwork", params: { visitId: visit.localId } })
            }
          >
            Link artwork
          </Stack.Toolbar.MenuAction>
          {!endingVisit && (
            <Stack.Toolbar.MenuAction icon="square.and.arrow.up" onPress={openSharing}>
              Prepare shared visit
            </Stack.Toolbar.MenuAction>
          )}
          {isPublic && (
            <Stack.Toolbar.MenuAction
              icon="lock"
              destructive
              disabled={changingVisibility || sharing.busy}
              onPress={() =>
                Alert.alert(
                  "Make this visit private?",
                  "Its shared version will be removed from profiles and feeds once the change syncs. Your artworks and notes stay in your collection.",
                  [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Make private",
                      style: "destructive",
                      onPress: () => {
                        void changeVisibility("private");
                      },
                    },
                  ],
                )
              }
            >
              Make private
            </Stack.Toolbar.MenuAction>
          )}
          {active && (
            <Stack.Toolbar.MenuAction
              icon="globe"
              onPress={() =>
                router.push({
                  pathname: "/visit-share/[visitId]/shared",
                  params: { visitId: visit.localId },
                })
              }
            >
              View shared version
            </Stack.Toolbar.MenuAction>
          )}
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
      <View style={styles.page}>
        <VisitPage>
          {saveError && (
            <Text accessibilityRole="alert" style={styles.error}>
              {saveError}
            </Text>
          )}
          {visibilityError && (
            <View
              style={{
                gap: 8,
                padding: 14,
                backgroundColor: "#FFF4DE",
                borderLeftWidth: 3,
                borderLeftColor: Gallery.warning,
              }}
            >
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
          {sharing.error && (
            <Text accessibilityRole="alert" style={styles.error}>
              {sharing.error}
            </Text>
          )}
          <View style={{ gap: 8 }}>
            <Text style={{ fontSize: 12, lineHeight: 18, color: Gallery.muted }}>
              {privacyPending
                ? "Privacy change pending"
                : isPublic
                  ? "Public visit"
                  : "Private visit"}
            </Text>
            <Text
              selectable
              accessibilityRole="header"
              style={[Typography.pageTitle, { color: Gallery.ink, fontSize: 42, lineHeight: 50 }]}
            >
              {visit.venueName}
            </Text>
            <Text selectable style={styles.caption}>
              {formatVisitDate(visit.visitedOn)}
              {visit.location ? ` · ${visit.location}` : ""}
            </Text>
          </View>
          {privacyPending && !visibilityError && (
            <View
              style={{
                padding: 14,
                backgroundColor: "#FFF4DE",
                borderLeftWidth: 3,
                borderLeftColor: Gallery.warning,
              }}
            >
              <Text style={{ color: Gallery.warning, fontSize: 14, lineHeight: 21 }}>
                Waiting to sync. The published visit is still visible.
              </Text>
            </View>
          )}
          <VisitNotes ref={notes} visit={visit} autoSave={!endingVisit} editable={!saving} />
          <View>
            <View style={styles.sectionLabel}>
              <Text accessibilityRole="header" style={detail.sectionTitle}>
                {visit.works.length
                  ? `${visit.works.length} ${visit.works.length === 1 ? "artwork" : "artworks"} saved`
                  : "Your artworks"}
              </Text>
              {!!visit.works.length && (
                <GalleryButton
                  label="Link artwork"
                  icon="plus"
                  onPress={() =>
                    router.push({ pathname: "/link-artwork", params: { visitId: visit.localId } })
                  }
                />
              )}
            </View>
            {visit.works.length > 8 && (
              <VisitGallerySearch value={search} onChangeText={setSearch} />
            )}
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
                    photo.owner === visit.owner &&
                    photo.savedLocalId === work.localId &&
                    photo.visitLocalId === visit.localId,
                );
                const cover =
                  album.find((photo) => photo.kind === "full") ??
                  album.find((photo) => photo.kind !== "label") ??
                  album[0];
                return (
                  <WorkLink
                    key={work.localId}
                    work={work}
                    visitId={visit.localId}
                    style={{ width: fontScale > 1.4 ? "100%" : "48%", flexShrink: 1 }}
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
            {!filtered.length &&
              (search.trim() ? (
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
                  <GalleryButton
                    label="Link artwork"
                    icon="plus"
                    variant="filled"
                    fullWidth
                    onPress={() =>
                      router.push({ pathname: "/link-artwork", params: { visitId: visit.localId } })
                    }
                  />
                </EmptyState>
              ))}
          </View>
        </VisitPage>
        <VisitActionBar
          endingVisit={endingVisit}
          isPublic={isPublic}
          pendingPrivate={pendingPrivate}
          changingVisibility={changingVisibility}
          sharingBusy={sharing.busy}
          saving={saving}
          onChangeVisibility={() => {
            void changeVisibility();
          }}
          onSave={() => {
            void save();
          }}
        />
      </View>
    </>
  );
}

const detail = StyleSheet.create({
  sectionTitle: { ...Typography.section, color: Gallery.ink },
});
