import { randomUUID } from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useIsFocused } from "expo-router/react-navigation";
import { useEffect, useRef, useState } from "react";
import { AppState, Pressable, ScrollView, StyleSheet, TextInput, useWindowDimensions, View } from "react-native";
import { usePhotoOutput } from "react-native-vision-camera";

import { GalleryButton } from "@/components/collection/gallery-button";
import { NativeSegmentedPicker } from "@/components/collection/native-segmented-picker";
import { SavedWorkImage } from "@/components/collection/saved-work-image";
import { LoadingImage } from "@/components/loading-image";
import { LoadingRing } from "@/components/loading-ring";
import { ThemedText } from "@/components/themed-text";
import { Gallery } from "@/constants/theme";
import { saveArtworkSession } from "@/db/repos/artwork-album";
import { getPendingScan } from "@/db/repos/pending-scans";
import { getSavedWork, listSavedWorks } from "@/db/repos/saved-works";
import { getVisit } from "@/db/repos/visits";
import { captureOwner, useLocalOwner } from "@/lib/account/owner-store";
import { removePhotoFile } from "@/lib/account/photo-transfer";
import { checkAlbumPhoto } from "@/lib/capture/check-album-photo";
import type { CaptureCompletion as Completion } from "@/lib/capture/completion";
import { extractCaptureMeta } from "@/lib/capture/exif";
import {
  clearPhotoDraft,
  readPhotoDraft,
  readPhotoSession,
  writePhotoDraft,
  type DraftPhoto,
} from "@/lib/capture/photo-draft";
import { captureVisitChoice } from "@/lib/capture/visit-choice";
import { keepPhotos, shrinkLibraryPhoto } from "@/lib/files/kept-photos";
import { captureFileUri, persistArtworkPhoto } from "@/lib/files/photos";
import { reportError } from "@/lib/observability";
import { useSaveResult } from "@/lib/result/use-save-result";
import { withEndVisitPrompt } from "@/lib/venue/end-visit-prompt";
import { visitForSave } from "@/lib/venue/use-venue";
import { venueNameById } from "@/lib/venue/venue-db";
import type { PhotoKind } from "@/shared/collection/album";

import type { Id } from "../../../convex/_generated/dataModel";
import { CameraPermission } from "./camera-permission";
import { CaptureArtworkMetadata } from "./capture-artwork-metadata";
import { CaptureCompletion } from "./capture-completion";
import { CaptureContextButton } from "./capture-context-button";
import { ContributionStatus, SHARING_NOTICE } from "./label/contribution-status";
import { TapToFocusCamera } from "./tap-to-focus-camera";

const MAX_CHECKS_PER_BATCH = 5;

export function AddPhotosScreen() {
  const params = useLocalSearchParams<{
    draftId: string;
    title?: string;
    savedId?: string;
    visitId?: string;
    objectId?: string;
  }>();
  const owner = useLocalOwner();
  return <PhotoSession key={`${owner}:${params.draftId}`} {...params} owner={owner} />;
}
function PhotoSession({
  draftId,
  title,
  savedId,
  visitId,
  objectId,
  owner,
}: {
  draftId: string;
  title?: string;
  savedId?: string;
  visitId?: string;
  objectId?: string;
  owner: string;
}) {
  const router = useRouter();
  const { fontScale, height } = useWindowDimensions();
  const [target, setTarget] = useState<Awaited<ReturnType<typeof getSavedWork>>>();
  useEffect(() => {
    let current = true;
    if (savedId) {
      void (async () => {
        try {
          const work = await getSavedWork(savedId, owner);
          if (current) setTarget(work);
        } catch (error) {
          reportError(error, "capture.load_album");
        }
      })();
    }
    return () => {
      current = false;
    };
  }, [savedId, owner]);
  const input = readPhotoSession(owner, draftId).saveInput;
  const [photos, setPhotos] = useState(() => readPhotoDraft(owner, draftId));
  const [albumCompletion, setCompletion] = useState<Completion>();
  const newArtwork = useSaveResult();
  const completion = albumCompletion ?? newArtwork.completion;
  const [kind, setKind] = useState<PhotoKind>("detail");
  const [selected, setSelected] = useState<string | undefined>(
    () => readPhotoDraft(owner, draftId).find((photo) => photo.review)?.localId ?? "",
  );
  const [removed, setRemoved] = useState<DraftPhoto>();
  const [operation, setOperation] = useState<"camera" | "library" | "saving" | "separating">();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string>();
  const busy = operation !== undefined;
  const focused = useIsFocused();
  const busyRef = useRef(false);
  const [appState, setAppState] = useState(AppState.currentState);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", setAppState);
    return () => subscription.remove();
  }, []);
  // A removed photo stays on disk only while Undo is offered; leaving the screen discards its file.
  const removedRef = useRef<DraftPhoto>(undefined);
  useEffect(() => {
    removedRef.current = removed;
  }, [removed]);
  useEffect(
    () => () => {
      if (removedRef.current) removePhotoFile(removedRef.current.path);
    },
    [],
  );
  const active = focused && appState === "active";
  const output = usePhotoOutput({ containerFormat: "jpeg", quality: 1 });
  const currentPhoto = photos.find((photo) => photo.localId === selected);
  const addingLabel = photos.some((photo) => photo.review === "checking") ? "Checking added photos…" : "Adding photos…";
  function update(next: DraftPhoto[]) {
    writePhotoDraft(owner, draftId, next);
    setPhotos(next);
  }
  async function acquire(source: "camera" | "library") {
    if (busyRef.current) return;
    busyRef.current = true;
    const session = captureOwner();
    setOperation(source);
    setError(undefined);
    try {
      const sources: { uri: string; capturedAt: number }[] = [];
      if (source === "camera") {
        const photo = await output.capturePhotoToFile({}, {});
        sources.push({
          uri: `file://${photo.filePath}`,
          capturedAt: Date.now(),
        });
      } else {
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images"],
          allowsMultipleSelection: true,
          selectionLimit: Math.max(1, 99 - photos.length),
          orderedSelection: true,
          exif: true,
          quality: 1,
        });
        if (!result.canceled) {
          sources.push(
            ...result.assets.map((photo) => ({
              uri: photo.uri,
              capturedAt: extractCaptureMeta(photo.exif).capturedAt,
            })),
          );
        }
      }
      const next = [...photos];
      let checks = 0;
      for (const { uri, capturedAt } of sources) {
        if (!session.isOwnerCurrent()) return;
        const localId = randomUUID();
        const path = await persistArtworkPhoto(source === "library" ? await shrinkLibraryPhoto(uri) : uri, localId);
        if (!session.isOwnerCurrent()) return;
        // Each recognition check is a full identify round trip; past the cap, full views wait for the user's confirmation instead.
        const check = kind === "full" && checks < MAX_CHECKS_PER_BATCH;
        const photo: DraftPhoto = {
          localId,
          path,
          kind,
          capturedAt,
          ...(kind === "full" ? { review: check ? "checking" : "uncertain" } : {}),
        };
        next.push(photo);
        // Persist each photo before asking the camera for another one.
        update([...next]);
        if (check) {
          checks++;
          const target = savedId ? await getSavedWork(savedId, owner) : undefined;
          const result = await checkAlbumPhoto(photo, target?.objectId ?? objectId);
          if (!session.isOwnerCurrent()) return;
          Object.assign(photo, result);
          update([...next]);
        }
      }
      setSelected(next.find((photo) => photo.review)?.localId);
    } catch (error) {
      reportError(error, "capture.add_photo", { data: { source } });
      setError("Could not add this photo. Try again.");
    } finally {
      busyRef.current = false;
      setOperation(undefined);
    }
  }
  const saveCapture = readPhotoSession(owner, draftId).saveInput?.capture;
  // The visit's day is the scan's, as the context chip shows it; an added photo's own date (a library pick may be weeks old) does not move it.
  const contextCapturedAt = saveCapture?.capturedAt ?? photos[0]?.capturedAt;
  // The same choice the context chip shows, so a separate save lands in the visit the chip names. A save kept out of a
  // visit open elsewhere keeps its museum, as the artwork's own save does. Undefined when the person cancels.
  function sessionVisit(): Promise<{ id?: string; venueId?: Id<"museums"> } | undefined> {
    return withEndVisitPrompt(async (withoutVisit) => {
      const session = readPhotoSession(owner, draftId);
      const choice = captureVisitChoice(
        {
          visitLocalId: visitId,
          venueId: saveCapture?.venueId,
          capturedAt: contextCapturedAt,
        },
        session,
      );
      if (choice.kind === "venue") {
        if (withoutVisit) return { venueId: choice.venueId };
        return { id: (await visitForSave(choice.venueId, contextCapturedAt ?? Date.now())).localId };
      }
      return { id: choice.kind === "visit" ? choice.localId : undefined };
    });
  }
  async function done() {
    if (busyRef.current || completion) return;
    if (photos.some((photo) => photo.review)) {
      setError("Review the unconfirmed photos before saving.");
      return;
    }
    busyRef.current = true;
    setOperation("saving");
    setError(undefined);
    const session = captureOwner();
    try {
      if (savedId) {
        if (photos.length === 0) return;
        const selected = await sessionVisit();
        if (!selected) return;
        const selectedVisitId = selected.id;
        const visit = selectedVisitId ? await getVisit(selectedVisitId, owner) : undefined;
        if (selectedVisitId && !visit) throw new Error("Visit unavailable");
        if (!session.isOwnerCurrent()) return;
        saveArtworkSession(
          savedId,
          undefined,
          photos.map((photo) => ({
            ...photo,
            savedLocalId: savedId,
            visitLocalId: selectedVisitId,
          })),
          selectedVisitId,
          owner,
        );
        clearPhotoDraft(owner, draftId);
        void keepPhotos(photos);
        setCompletion({
          savedId,
          title: target?.title || title || "Unidentified artwork",
          artist: target?.artist,
          date: target?.date,
          medium: target?.medium,
          previewPath: target?.cropPath ?? photos[0]?.path ?? null,
          visit: visit
            ? {
                localId: visit.localId,
                venueName: visit.venueName,
                startedAt: visit.startedAt,
                visitedOn: visit.visitedOn,
                timeZone: visit.timeZone,
                outcome: visit.endedAt === null && visit.startedAt !== null ? "joined" : "past",
              }
            : undefined,
        });
      } else {
        const input = readPhotoSession(owner, draftId).saveInput;
        if (!input) throw new Error("Capture unavailable");
        const capture = await getPendingScan(input.capture.localId, owner);
        if (!capture || !session.isOwnerCurrent()) {
          throw new Error("Capture unavailable");
        }
        await newArtwork.save({
          ...input,
          capture,
          contribution: input.contribution ? { ...input.contribution, capture } : undefined,
        });
      }
    } catch (error) {
      reportError(error, "capture.save_photos");
      setError("Could not save the photos. Your draft is still here.");
    } finally {
      busyRef.current = false;
      setOperation(undefined);
    }
  }
  async function saveSeparately(photo: DraftPhoto) {
    if (busyRef.current) return;
    busyRef.current = true;
    const session = captureOwner();
    setOperation("separating");
    try {
      const existing = photo.recognized
        ? (await listSavedWorks(owner)).find((work) => work.objectId === photo.recognized!.objectId)
        : undefined;
      const selected = await sessionVisit();
      if (!selected) return;
      const selectedVisitId = selected.id;
      const visit = selectedVisitId ? await getVisit(selectedVisitId, owner) : undefined;
      if (selectedVisitId && !visit) throw new Error("Visit unavailable");
      const venueId = visit?.venueId ?? selected.venueId;
      const venueName = visit?.venueName ?? (venueId ? await venueNameById(venueId) : undefined);
      if (!session.isOwnerCurrent()) return;
      const id = existing?.localId ?? randomUUID();
      saveArtworkSession(
        id,
        existing
          ? undefined
          : {
              localId: id,
              title: photo.recognized?.title ?? "Unidentified artwork",
              artist: photo.recognized?.artist ?? "",
              objectId: photo.recognized?.objectId,
              artworkId: photo.recognized?.artworkId,
              savedAt: photo.capturedAt,
              photoPath: photo.path,
              cropPath: photo.path,
              visitLocalId: visit?.localId,
              venueId,
              venueName,
            },
        [
          {
            localId: photo.localId,
            path: photo.path,
            kind: photo.kind,
            capturedAt: photo.capturedAt,
            savedLocalId: id,
            visitLocalId: visit?.localId,
            caption: photo.caption,
          },
        ],
        visit?.localId,
        owner,
      );
      void keepPhotos([photo]);
      update(photos.filter((row) => row.localId !== photo.localId));
      setSelected(undefined);
    } catch (error) {
      reportError(error, "capture.save_separate_photo");
      setError("Could not save this photo separately. Your draft is still here.");
    } finally {
      busyRef.current = false;
      setOperation(undefined);
    }
  }
  if (completion) {
    const status = (
      <ContributionStatus
        sharing={newArtwork.sharing}
        shared={newArtwork.shared}
        shareError={newArtwork.shareError}
        onShare={() => {
          void newArtwork.retrySharing();
        }}
      />
    );
    return (
      <CaptureCompletion
        completion={completion}
        sharedToIndex={newArtwork.shared?.status === "tentative"}
        status={status}
      >
        <ScrollView
          style={{ flex: 1, backgroundColor: Gallery.paper }}
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={styles.page}
        >
          <SavedWorkImage
            path={completion.previewPath}
            title={completion.title}
            contain
            style={{ width: "100%", height: Math.min(360, height * 0.36) }}
          />
          <ThemedText type="title">{completion.title}</ThemedText>
          <CaptureArtworkMetadata completion={completion} />
          <GalleryButton
            label="View artwork"
            fullWidth
            onPress={() => router.navigate({ pathname: "/saved/[savedId]", params: { savedId: completion.savedId } })}
          />
          {status}
        </ScrollView>
      </CaptureCompletion>
    );
  }
  const photoCount = photos.length + (savedId ? 0 : 1);
  const artist = target?.artist || input?.draft.artist;
  const shares = !savedId && !!saveCapture && !!readPhotoSession(owner, draftId).saveInput?.contribution;
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.page}
      contentInsetAdjustmentBehavior="automatic"
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen options={{ title: "Add photos" }} />
      <View style={[styles.target, { flexDirection: "row", alignItems: "center", gap: 12 }]}>
        <SavedWorkImage
          path={target?.cropPath ?? input?.capture.cropPath ?? null}
          title={target?.title ?? title ?? "Artwork"}
          contain
          style={{ width: 48, height: 56 }}
        />
        <View style={{ flex: 1, gap: 3 }}>
          <ThemedText style={{ fontSize: 16, fontWeight: "600" }}>
            {target?.title || title || "Unidentified artwork"}
          </ThemedText>
          {artist && (
            <ThemedText type="small" style={styles.hint}>
              {artist}
            </ThemedText>
          )}
        </View>
      </View>
      <CaptureContextButton
        capture={{
          photoPath: draftId,
          visitLocalId: visitId,
          venueId: saveCapture?.venueId,
          capturedAt: contextCapturedAt,
        }}
        disabled={busy}
      />
      <NativeSegmentedPicker
        label={currentPhoto ? "Photo type" : "Next photo type"}
        value={currentPhoto?.kind ?? kind}
        disabled={busy}
        options={[
          { value: "full", label: "Full view" },
          { value: "detail", label: "Detail" },
          { value: "label", label: "Label" },
        ]}
        onChange={(value) =>
          currentPhoto
            ? update(
                photos.map((photo) =>
                  photo.localId === currentPhoto.localId ? { ...photo, kind: value as PhotoKind } : photo,
                ),
              )
            : setKind(value as PhotoKind)
        }
      />
      {currentPhoto ? (
        <LoadingImage
          uri={captureFileUri(currentPhoto.path)}
          label="Selected artwork photo"
          style={styles.preview}
          contentFit="contain"
        />
      ) : (
        <CameraPermission compact loading={active && !ready && !error && !busy}>
          <View style={styles.camera}>
            <TapToFocusCamera
              device="back"
              outputs={[output]}
              isActive={active}
              resizeMode="cover"
              orientationSource="interface"
              onStarted={() => setReady(true)}
              onStopped={() => setReady(false)}
              onError={(error) => {
                reportError(error, "camera.start", {
                  data: { screen: "add_photos" },
                });
                setError("Camera unavailable. Add photos from your library.");
              }}
            />
          </View>
        </CameraPermission>
      )}
      {currentPhoto ? (
        <View style={{ gap: 4 }}>
          {!!currentPhoto.review && (
            <View
              style={{
                gap: 8,
                padding: 16,
                backgroundColor: Gallery.fill,
                borderLeftWidth: 3,
                borderLeftColor: Gallery.warning,
              }}
            >
              {currentPhoto.review === "checking" && busy ? (
                <LoadingRing accessibilityLabel="Checking this photo…" />
              ) : (
                <ThemedText themeColor="warning">
                  {currentPhoto.review === "conflict"
                    ? `This looks like ${currentPhoto.recognized?.title ?? "a different artwork"}.`
                    : "We couldn’t confirm that this is the same artwork."}
                </ThemedText>
              )}
              <GalleryButton
                label="Keep with this artwork"
                disabled={busy}
                onPress={() =>
                  update(
                    photos.map((photo) =>
                      photo.localId === currentPhoto.localId ? { ...photo, review: undefined } : photo,
                    ),
                  )
                }
              />
              <GalleryButton
                label="Save as a separate artwork"
                busy={operation === "separating"}
                busyLabel="Saving separately…"
                disabled={busy}
                onPress={() => {
                  void saveSeparately(currentPhoto);
                }}
              />
            </View>
          )}
          <ThemedText type="smallBold">Private caption</ThemedText>
          <TextInput
            accessibilityLabel="Photo caption"
            keyboardAppearance="light"
            selectionColor={Gallery.accent}
            placeholderTextColor={Gallery.muted}
            multiline
            placeholder="Add a private caption"
            editable={!busy}
            value={currentPhoto.caption ?? ""}
            maxLength={2000}
            style={styles.caption}
            onChangeText={(caption) =>
              update(photos.map((photo) => (photo.localId === currentPhoto.localId ? { ...photo, caption } : photo)))
            }
          />
          <View style={[styles.row, fontScale >= 1.5 && styles.stacked]}>
            <GalleryButton label="Back to camera" disabled={busy} onPress={() => setSelected(undefined)} />
            <GalleryButton
              label="Remove photo"
              disabled={busy}
              destructive
              onPress={() => {
                if (removed) removePhotoFile(removed.path);
                setRemoved(currentPhoto);
                update(photos.filter((photo) => photo.localId !== currentPhoto.localId));
                setSelected(undefined);
              }}
            />
          </View>
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          <GalleryButton
            label="Take photo"
            icon="camera"
            variant="filled"
            fullWidth
            busy={operation === "camera"}
            busyLabel={addingLabel}
            disabled={!ready || busy || photos.length >= 99}
            onPress={() => {
              void acquire("camera");
            }}
          />
          <GalleryButton
            label="Import a photo"
            icon="photo"
            variant="outlined"
            fullWidth
            busy={operation === "library"}
            busyLabel={addingLabel}
            disabled={busy || photos.length >= 99}
            onPress={() => {
              void acquire("library");
            }}
          />
          {photos.length > 0 && (
            <ThemedText type="small" style={styles.hint}>
              {photos.length} new {photos.length === 1 ? "photo" : "photos"}
            </ThemedText>
          )}
        </View>
      )}
      <ScrollView horizontal style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 8 }}>
        {photos.map((photo, i) => (
          <Pressable
            key={photo.localId}
            accessibilityRole="button"
            accessibilityLabel={`Review ${photo.kind} photo ${i + 1}`}
            accessibilityState={{
              selected: selected === photo.localId,
              disabled: busy,
            }}
            disabled={busy}
            onPress={() => setSelected(photo.localId)}
            style={[
              styles.thumb,
              selected === photo.localId && {
                borderColor: Gallery.ink,
                backgroundColor: Gallery.highlight,
              },
            ]}
          >
            <LoadingImage
              uri={captureFileUri(photo.path)}
              label={`${photo.kind} photo`}
              style={{ width: 58, height: 58 }}
              contentFit="cover"
            />
            <ThemedText type="small" style={styles.thumbLabel}>
              {photo.kind}
            </ThemedText>
          </Pressable>
        ))}
      </ScrollView>
      {photos.length >= 99 && (
        <ThemedText themeColor="warning">Photo limit reached. Remove a photo to add another.</ThemedText>
      )}
      {removed && (
        <GalleryButton
          label="Photo removed · Undo"
          disabled={busy}
          onPress={() => {
            update([...photos, removed]);
            setRemoved(undefined);
          }}
        />
      )}
      {(error || newArtwork.error) && (
        <ThemedText accessibilityRole="alert" style={{ color: Gallery.destructive }}>
          {error || newArtwork.error}
        </ThemedText>
      )}
      {photoCount > 0 && (
        <GalleryButton
          label={`Save ${photoCount} ${photoCount === 1 ? "photo" : "photos"}`}
          variant="filled"
          fullWidth
          busy={operation === "saving"}
          busyLabel="Saving photos…"
          disabled={busy || !photoCount || photos.some((photo) => !!photo.review)}
          onPress={() => {
            void done();
          }}
        />
      )}
      <ThemedText style={[styles.hint, { textAlign: "center" }]}>
        {shares ? SHARING_NOTICE : "Only you can see these photos."}
      </ThemedText>
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Gallery.paper },
  page: { flexGrow: 1, padding: 20, paddingBottom: 30, gap: 12 },
  target: {
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Gallery.separator,
    gap: 8,
  },
  hint: { color: Gallery.muted },
  preview: { width: "100%", aspectRatio: 1 },
  camera: {
    width: "100%",
    aspectRatio: 1,
    overflow: "hidden",
    backgroundColor: Gallery.fill,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  stacked: { flexDirection: "column", alignItems: "stretch" },
  thumb: {
    borderWidth: 2,
    borderColor: "transparent",
    borderRadius: 2,
    overflow: "hidden",
  },
  thumbLabel: { textAlign: "center", color: Gallery.ink, paddingVertical: 4 },
  caption: {
    minHeight: 44,
    fontSize: 17,
    lineHeight: 25,
    backgroundColor: Gallery.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Gallery.controlBorder,
    padding: 12,
    color: Gallery.ink,
  },
});
