import { useState, type ReactNode } from "react";
import { Linking, ScrollView, StyleSheet, View } from "react-native";
import { useCameraPermission } from "react-native-vision-camera";

import { GalleryButton } from "@/components/collection/gallery-button";
import { EmptyState, EmptySymbol } from "@/components/empty-state";
import { ArtworkCollage } from "@/components/guest/artwork-preview";
import { LoadingRing } from "@/components/loading-ring";
import { ThemedText } from "@/components/themed-text";
import { reportError } from "@/lib/observability";
import { showErrorToast } from "@/lib/ui/toast";

/** `notice` is the capture's own retry message, shown here because the camera overlay that normally carries it is not mounted. */
export function CameraPermission({
  children,
  onImport,
  notice,
  compact = false,
  loading = false,
  bottomInset = 0,
}: {
  children: ReactNode;
  onImport?: () => void;
  notice?: string;
  compact?: boolean;
  loading?: boolean;
  bottomInset?: number;
}) {
  const { hasPermission, canRequestPermission, requestPermission } = useCameraPermission();
  const [busy, setBusy] = useState(false);
  async function openPermissions() {
    if (busy) return;
    setBusy(true);
    try {
      await (canRequestPermission ? requestPermission() : Linking.openSettings());
    } catch (error) {
      reportError(error, "camera.request_permission");
      showErrorToast("Couldn’t open camera permissions.", () => void openPermissions());
    } finally {
      setBusy(false);
    }
  }
  if (hasPermission) {
    return (
      <>
        {children}
        {loading && (
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <LoadingRing accessibilityLabel="Starting camera…" style={{ flex: 1 }} />
          </View>
        )}
      </>
    );
  }
  const invitation = (
    <EmptyState
      inset={false}
      visual={compact ? <EmptySymbol name="camera" /> : <ArtworkCollage />}
      title={canRequestPermission ? "Camera access needed" : "Camera access is off."}
      detail={
        canRequestPermission
          ? "Point your camera at an artwork to learn more and keep it in your collection."
          : "Allow camera access in Settings, or choose a photo from your library."
      }
    >
      <GalleryButton
        label={canRequestPermission ? "Allow camera" : "Open Settings"}
        variant="filled"
        fullWidth
        busy={busy}
        onPress={() => void openPermissions()}
      />
      {onImport && <GalleryButton label="Import a photo" variant="outlined" fullWidth onPress={onImport} />}
      {notice && (
        <ThemedText themeColor="error" accessibilityRole="alert">
          {notice}
        </ThemedText>
      )}
    </EmptyState>
  );
  return compact ? (
    <View style={{ paddingVertical: 12 }}>{invitation}</View>
  ) : (
    <ScrollView
      style={{ marginBottom: bottomInset }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        flexGrow: 1,
        justifyContent: "center",
        padding: 20,
      }}
    >
      {invitation}
    </ScrollView>
  );
}
