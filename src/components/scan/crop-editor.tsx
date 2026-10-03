import { ImageManipulator } from "expo-image-manipulator";
import { Stack } from "expo-router";
import { useIsFocused } from "expo-router/react-navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GalleryButton } from "@/components/collection/gallery-button";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery } from "@/constants/theme";
import { fitPhoto, validCrop, wholePhoto } from "@/lib/capture/crop-geometry";
import { discardEditedCrop, prepareEditedCrop, type EditedCrop } from "@/lib/capture/edit-crop";
import type { Quad } from "@/lib/capture/stages";
import { captureFileUri } from "@/lib/files/photos";
import { reportError } from "@/lib/observability";
import { showErrorToast, useLiftToasts } from "@/lib/ui/toast";

import { CropCorners } from "./crop-corners";

// Corner handles reach this far past the photo, so the photo keeps that much room at its sides and above the buttons.
const HANDLE_REACH = 24;
const PHOTO_TOP = 16;

export function CropEditor({
  photoPath,
  initialCorners,
  saveLabel = "Save crop",
  onSave,
  onCancel,
}: {
  photoPath: string;
  /** Where the current crop sits in the photo; the editor starts from the whole photo without them. */
  initialCorners?: Quad | null;
  saveLabel?: string;
  onSave: (crop: EditedCrop, isCurrent: () => boolean) => Promise<void>;
  onCancel: () => void;
}) {
  const [size, setSize] = useState<{ width: number; height: number }>();
  const [corners, setCorners] = useState<Quad>(() =>
    initialCorners && validCrop(initialCorners) ? initialCorners : wholePhoto,
  );
  const [busy, setBusy] = useState<"loading" | "saving" | undefined>("loading");
  const [attempt, setAttempt] = useState(0);
  const active = useRef(false);
  const working = useRef(false);
  const activeDrags = useRef(0);
  const [dragging, setDragging] = useState(false);
  const startDrag = useCallback(() => {
    activeDrags.current += 1;
    setDragging(true);
  }, []);
  const endDrag = useCallback(() => {
    activeDrags.current = Math.max(0, activeDrags.current - 1);
    setDragging(activeDrags.current > 0);
  }, []);
  const insets = useSafeAreaInsets();
  const bottomPadding = Math.max(insets.bottom, 16);
  const [stage, setStage] = useState<{ width: number; height: number }>();
  const [controls, setControls] = useState<{ y: number; height: number }>();
  // Toasts clear the buttons, and sit in the spare height under them when they fit there.
  const controlEdges = stage
    && controls && {
      top: stage.height - controls.y + bottomPadding,
      bottom: stage.height - controls.y - controls.height + bottomPadding,
    };
  useLiftToasts(controlEdges?.top, useIsFocused(), controlEdges?.bottom);
  const uri = captureFileUri(photoPath);
  // The photo hugs its own shape and the buttons follow it, so spare height collects below the buttons.
  const photoBox =
    size
    && stage
    && fitPhoto(size, {
      width: stage.width - 2 * HANDLE_REACH,
      height: Math.max(0, stage.height - PHOTO_TOP - HANDLE_REACH - (controls?.height ?? 0)),
    });
  useEffect(() => {
    active.current = true;
    let cancelled = false;
    const context = ImageManipulator.manipulate(uri);
    void (async () => {
      let photo;
      try {
        photo = await context.renderAsync();
        if (cancelled) return;
        setSize({ width: photo.width, height: photo.height });
        setBusy(undefined);
      } catch (error) {
        if (!cancelled) {
          reportError(error, "capture.open_crop");
          showErrorToast("Couldn’t open the full photo. Try again once it’s on this iPhone.", reopen);
          setBusy(undefined);
        }
      } finally {
        photo?.release();
        context.release();
      }
    })();
    return () => {
      cancelled = true;
      active.current = false;
    };
  }, [uri, attempt]);

  const saving = busy === "saving";
  // Keep native toolbar options stable as photo loading and crop commits update the editor.
  const header = useMemo(
    () => (
      <>
        <Stack.Screen options={{ headerBackVisible: false }} />
        <Stack.Toolbar placement="left">
          <Stack.Toolbar.Button disabled={saving} tintColor={Gallery.accent} onPress={onCancel}>
            Cancel
          </Stack.Toolbar.Button>
        </Stack.Toolbar>
      </>
    ),
    [saving, onCancel],
  );
  function reopen() {
    setBusy("loading");
    setAttempt((value) => value + 1);
  }
  async function save() {
    if (working.current || activeDrags.current > 0) return;
    working.current = true;
    setBusy("saving");
    let crop: EditedCrop | undefined;
    try {
      crop = await prepareEditedCrop(photoPath, corners);
      if (active.current) await onSave(crop, () => active.current);
    } catch (error) {
      // Save is the retry, and it uses the corners as they are now.
      if (active.current) {
        reportError(error, "capture.save_crop");
        showErrorToast("Couldn’t save this crop. Your previous crop is still available.");
      }
    } finally {
      // onSave copies what it keeps, so the prepared files are temporary either way.
      if (crop) discardEditedCrop(crop);
      working.current = false;
      if (active.current) setBusy(undefined);
    }
  }
  return (
    <View style={[styles.screen, { paddingBottom: bottomPadding }]}>
      {header}
      <Text style={styles.instructions}>Drag each corner onto the painting’s corners.</Text>
      <View testID="crop-stage" style={styles.stage} onLayout={({ nativeEvent: { layout } }) => setStage(layout)}>
        {photoBox ? (
          <View style={[styles.photo, { width: photoBox.width, height: photoBox.height }]}>
            <CropCorners
              uri={uri}
              size={size}
              corners={corners}
              onChange={setCorners}
              onDragStart={startDrag}
              onDragEnd={endDrag}
              disabled={saving}
            />
          </View>
        ) : (
          !size && (
            <View style={styles.loading}>
              <Text>{busy === "loading" ? "Opening full photo…" : "Full photo unavailable"}</Text>
            </View>
          )
        )}
        <ScrollView
          // ScrollView shrinks by default, which would squeeze the buttons out from under a photo sized to leave them room.
          style={{ flexGrow: 0, flexShrink: 0, maxHeight: "45%" }}
          contentContainerStyle={styles.controls}
          onLayout={({ nativeEvent: { layout } }) => setControls(layout)}
        >
          {size ? (
            <GalleryButton
              label={saveLabel}
              variant="filled"
              fullWidth
              disabled={dragging}
              busy={saving}
              busyLabel="Saving crop…"
              onPress={() => {
                void save();
              }}
            />
          ) : !busy ? (
            <GalleryButton label="Retry" onPress={reopen} />
          ) : null}
        </ScrollView>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Gallery.paper },
  instructions: { paddingHorizontal: 24, paddingTop: 16, color: Gallery.muted },
  stage: { flex: 1 },
  photo: { alignSelf: "center", marginTop: PHOTO_TOP, marginBottom: HANDLE_REACH },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  controls: { paddingHorizontal: 24, gap: 4 },
});
