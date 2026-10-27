import { Image } from "expo-image";
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { Modal, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";

import { GalleryButton } from "@/components/collection/gallery-button";
import { MotionPressable } from "@/components/motion-pressable";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, Radius, Spacing } from "@/constants/theme";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { copyForImport, listDemoPhotos, type DemoPhotos } from "@/lib/capture/demo-photos";
import type { PickedPhoto } from "@/lib/capture/use-capture";
import { reportError } from "@/lib/observability";

export type DemoPhotoSheetHandle = { pick(): Promise<PickedPhoto | null> };

/** Uploads from the demo page arrive while the sheet is open. */
export const UPLOAD_REFRESH_MS = 2000;

/**
 * The judges' demo build's photo picker: the gallery stills and the judge's uploads only, never the phone's own
 * library, whose sample photos are not artwork.
 */
export function DemoPhotoSheet({ ref }: { ref: Ref<DemoPhotoSheetHandle> }) {
  const reduced = useReducedMotion();
  const { width, fontScale } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const [photos, setPhotos] = useState<DemoPhotos>({ gallery: [], uploads: [] });
  const resolve = useRef<(photo: PickedPhoto | null) => void>(undefined);
  const refresh = () =>
    setPhotos((current) => {
      const next = listDemoPhotos();
      return JSON.stringify(next) === JSON.stringify(current) ? current : next;
    });
  useImperativeHandle(
    ref,
    () => ({
      pick: () =>
        new Promise<PickedPhoto | null>((done) => {
          resolve.current?.(null);
          resolve.current = done;
          refresh();
          setOpen(true);
        }),
    }),
    [],
  );
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(refresh, UPLOAD_REFRESH_MS);
    return () => clearInterval(timer);
  }, [open]);

  const finish = (photo: PickedPhoto | null) => {
    setOpen(false);
    resolve.current?.(photo);
    resolve.current = undefined;
  };
  const choose = async (uri: string) => {
    try {
      finish(await copyForImport(uri));
    } catch (error) {
      reportError(error, "capture.demo_photo_copy");
      finish(null);
    }
  };
  const columns = fontScale > 1.4 ? 1 : 3;
  const size = (width - Spacing.content * 2 - (columns - 1) * Spacing.two) / columns;
  const grid = (uris: string[], label: string) => (
    <View style={styles.grid}>
      {uris.map((uri, index) => (
        <MotionPressable
          key={uri}
          accessibilityRole="button"
          accessibilityLabel={`${label} ${index + 1}`}
          onPress={() => void choose(uri)}
          style={{ width: size, height: size }}
        >
          <Image source={{ uri }} contentFit="cover" cachePolicy="memory" style={styles.photo} />
        </MotionPressable>
      ))}
    </View>
  );

  return (
    <Modal
      visible={open}
      animationType={reduced ? "fade" : "slide"}
      presentationStyle="pageSheet"
      onRequestClose={() => finish(null)}
    >
      <ScrollView style={styles.sheet} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text variant="section" accessibilityRole="header" style={styles.title}>
            Choose a photo
          </Text>
          <GalleryButton label="Cancel" onPress={() => finish(null)} />
        </View>
        <View style={styles.section}>
          <Text variant="eyebrow" themeColor="textSecondary" accessibilityRole="header">
            Gallery photos
          </Text>
          {grid(photos.gallery, "Gallery photo")}
        </View>
        <View style={styles.section}>
          <Text variant="eyebrow" themeColor="textSecondary" accessibilityRole="header">
            Your photos
          </Text>
          {photos.uploads.length > 0 ? (
            grid(photos.uploads, "Your photo")
          ) : (
            <Text variant="secondary" themeColor="textSecondary">
              Photos you upload on the demo page appear here.
            </Text>
          )}
        </View>
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: Gallery.paper },
  content: { padding: Spacing.content, gap: Spacing.four },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: Spacing.two },
  title: { flexShrink: 1 },
  section: { gap: Spacing.compact },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  photo: { flex: 1, borderRadius: Radius.thumbnail },
});
