import { useNetworkState } from "expo-network";
import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { LoadingRing } from "@/components/loading-ring";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, Spacing } from "@/constants/theme";
import type { useAccount } from "@/lib/account/use-account";
import { isOffline } from "@/lib/network-state";

import { ProviderSignInButton, SIGN_IN_BUTTON_HEIGHT } from "./provider-sign-in-button";

type SignInState = Pick<
  ReturnType<typeof useAccount>,
  "available" | "googleAvailable" | "busy" | "error" | "ready" | "signInWithApple" | "signInWithGoogle"
>;

export function SignInActions({ state }: { state: SignInState }) {
  const network = useNetworkState();
  const [buttonHeight, setButtonHeight] = useState(SIGN_IN_BUTTON_HEIGHT);
  // Offline, the device never becomes ready, so say so instead of spinning until the sheet is dismissed.
  const offline = isOffline(network);
  const disabled = state.busy || !state.ready || offline;
  const googleDisabled = disabled || !state.googleAvailable;
  return (
    <View style={styles.root}>
      {state.available ? (
        <ProviderSignInButton
          provider="apple"
          disabled={disabled}
          busy={state.busy}
          minHeight={buttonHeight}
          onPress={() => void state.signInWithApple()}
        />
      ) : state.ready ? (
        <Text style={styles.footnote}>Apple sign-in is unavailable on this device.</Text>
      ) : null}
      {/* Google has the longer label; its wrapped height keeps both buttons aligned. */}
      <View onLayout={({ nativeEvent }) => setButtonHeight(Math.max(SIGN_IN_BUTTON_HEIGHT, nativeEvent.layout.height))}>
        <ProviderSignInButton
          provider="google"
          disabled={googleDisabled}
          busy={state.busy}
          onPress={() => void state.signInWithGoogle()}
        />
      </View>
      {state.busy ? (
        <View style={styles.progress}>
          <LoadingRing accessibilityLabel="Signing in…" color={Gallery.accent} />
          <Text style={styles.footnote}>Signing in…</Text>
        </View>
      ) : offline ? (
        <Text style={styles.footnote}>Connect to the internet to sign in.</Text>
      ) : !state.ready ? (
        <View style={styles.progress}>
          <LoadingRing accessibilityLabel="Connecting to your account" />
        </View>
      ) : null}
      {state.error && (
        <Text selectable accessibilityRole="alert" style={styles.error}>
          {state.error}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: Spacing.two, width: "100%" },
  progress: { minHeight: 50, gap: Spacing.two, alignItems: "center", justifyContent: "center" },
  footnote: {
    fontSize: 13,
    lineHeight: 18,
    color: Gallery.muted,
    textAlign: "center",
  },
  error: { fontSize: 14, lineHeight: 20, color: Gallery.destructive },
});
