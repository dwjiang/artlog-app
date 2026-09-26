import { useRef, useState } from "react";
import { Linking, View } from "react-native";

import { GalleryButton } from "@/components/collection/gallery-button";
import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import { APP_STORE_URL } from "@/lib/app-update";
import { reportError } from "@/lib/observability";

export function AppUpdateButton({ label = "Update Artlog" }: { label?: string }) {
  const opening = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function openStore() {
    if (opening.current) return;
    opening.current = true;
    setBusy(true);
    setError(false);
    try {
      await Linking.openURL(APP_STORE_URL);
    } catch (cause) {
      reportError(cause, "app-update.open-store", { level: "warning" });
      setError(true);
    } finally {
      opening.current = false;
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: Spacing.two }}>
      <GalleryButton
        label={label}
        icon="arrow.up.right"
        iconPosition="trailing"
        variant="filled"
        fullWidth
        busy={busy}
        busyLabel="Opening the App Store"
        onPress={() => void openStore()}
      />
      {error && (
        <ThemedText accessibilityRole="alert" themeColor="error" type="small">
          Couldn’t open the App Store. Try again.
        </ThemedText>
      )}
    </View>
  );
}
