import { useMutation } from "convex/react";
import Constants from "expo-constants";
import { getNetworkStateAsync } from "expo-network";
import { router, Stack } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Platform, ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GalleryButton } from "@/components/collection/gallery-button";
import { GalleryIconButton } from "@/components/collection/gallery-icon-button";
import { ThemedText as Text } from "@/components/themed-text";
import { ToastLayer } from "@/components/toast";
import { Gallery, Typography } from "@/constants/theme";
import { useFittedFormSheetStyle } from "@/hooks/use-fitted-sheet";
import { convexErrorCode } from "@/lib/network-error";
import { reportError } from "@/lib/observability";
import { showErrorToast, showToast } from "@/lib/ui/toast";
import { useDeviceReady } from "@/lib/use-device-ready";
import { LIMITS } from "@/shared/journal/limits";

import { api } from "../../../convex/_generated/api";

export function SendFeedbackScreen() {
  const submit = useMutation(api.appFeedback.submit);
  const deviceReady = useDeviceReady();
  const { fontScale } = useWindowDimensions();
  const sheetStyle = useFittedFormSheetStyle();
  const { bottom } = useSafeAreaInsets();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Retry resends the failed text and can outlive the sheet, since the toast moves to the root layer when it closes.
  async function send(text: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      // Convex queues mutations while offline instead of failing, so the send would never settle.
      const network = await getNetworkStateAsync();
      if (network.isConnected === false || network.isInternetReachable === false) {
        showErrorToast("Couldn’t send feedback while offline.", () => void send(text));
        return;
      }
      await submit({
        message: text,
        appVersion: `${Constants.nativeAppVersion ?? Constants.expoConfig?.version ?? "Unknown"} (${Constants.nativeBuildVersion ?? "dev"})`,
        osVersion: `iOS ${Platform.Version}`,
      });
      showToast("Feedback sent. Thank you.");
      if (mounted.current) router.back();
    } catch (cause) {
      reportError(cause, "feedback.send");
      if (convexErrorCode(cause) === "rate_limited") {
        showErrorToast("Couldn’t send feedback. Try again tomorrow.");
      } else {
        showErrorToast("Couldn’t send feedback.", () => void send(text));
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ gestureEnabled: !busy }} />
      <ScrollView
        style={[styles.root, sheetStyle]}
        bounces={false}
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
      >
        <View style={styles.header}>
          <Text accessibilityRole="header" style={[styles.title, fontScale > 1.3 && Typography.display]}>
            Send feedback
          </Text>
          <GalleryIconButton label="Close" icon="xmark" disabled={busy} onPress={() => router.back()} />
        </View>
        <TextInput
          accessibilityLabel="Feedback"
          value={message}
          onChangeText={setMessage}
          placeholder="Describe a problem or share an idea…"
          maxLength={LIMITS.feedbackMessage}
          multiline
          autoFocus
          editable={!busy}
          keyboardAppearance="light"
          selectionColor={Gallery.accent}
          placeholderTextColor={Gallery.muted}
          style={styles.input}
        />
        <GalleryButton
          label="Send"
          busyLabel="Sending…"
          variant="filled"
          fullWidth
          busy={busy}
          disabled={!deviceReady || !message.trim()}
          onPress={() => {
            void send(message.trim());
          }}
        />
      </ScrollView>
      {/* The sheet covers the root toast layer, and it already clears the home indicator, so the layer's safe-area
          padding is cancelled. A failure toast covers Send; its Retry sends the same message. */}
      <ToastLayer offset={-bottom} />
    </>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: Gallery.paper },
  content: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 20, gap: 12 },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 4 },
  title: { ...Typography.display, fontSize: 36, lineHeight: 42, flex: 1, color: Gallery.ink },
  input: {
    minHeight: 160,
    padding: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Gallery.controlBorder,
    color: Gallery.ink,
    backgroundColor: Gallery.surface,
    fontSize: 17,
    textAlignVertical: "top",
  },
});
