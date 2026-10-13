import { useState, type ReactNode } from "react";
import { Linking, ScrollView, StyleSheet, View } from "react-native";
import { useCameraPermission } from "react-native-vision-camera";

import { ActionStack } from "@/components/action-stack";
import { GalleryButton } from "@/components/collection/gallery-button";
import { EmptyState, EmptySymbol } from "@/components/empty-state";
import { EmptyViewfinder } from "@/components/empty-state-art";
import { LoadingRing } from "@/components/loading-ring";
import { reportError } from "@/lib/observability";
import { showErrorToast } from "@/lib/ui/toast";

export function CameraPermission({
  children,
  onImport,
  importBusy = false,
  importBusyLabel = "Importing…",
  fallback,
  compact = false,
  loading = false,
  bottomInset = 0,
}: {
  children: ReactNode;
  onImport?: () => void;
  importBusy?: boolean;
  importBusyLabel?: string;
  fallback?: ReactNode;
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
  if (fallback) return <>{fallback}</>;
  const invitation = (
    <EmptyState
      inset={false}
      visual={compact ? <EmptySymbol name="camera" /> : <EmptyViewfinder />}
      title={canRequestPermission ? "Camera access needed." : "Camera access is off."}
      detail={
        canRequestPermission
          ? "Point your camera at an artwork to learn more and keep it in your collection."
          : "Allow camera access in Settings, or choose a photo from your library."
      }
    >
      <ActionStack
        textActions={
          onImport && (
            <GalleryButton
              label="Import a photo"
              fullWidth
              busy={importBusy}
              busyLabel={importBusyLabel}
              onPress={onImport}
            />
          )
        }
      >
        <GalleryButton
          label={canRequestPermission ? "Continue" : "Open Settings"}
          variant="filled"
          fullWidth
          busy={busy}
          onPress={() => void openPermissions()}
        />
      </ActionStack>
    </EmptyState>
  );
  return compact ? (
    <View style={{ paddingVertical: 12 }}>{invitation}</View>
  ) : (
    <ScrollView
      style={{ marginBottom: bottomInset }}
      contentInsetAdjustmentBehavior="automatic"
      alwaysBounceVertical={false}
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
