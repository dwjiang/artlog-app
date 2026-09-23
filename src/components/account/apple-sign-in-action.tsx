import * as AppleAuthentication from "expo-apple-authentication";
import { useNetworkState } from "expo-network";
import { StyleSheet, View } from "react-native";
import { LoadingRing } from "@/components/loading-ring";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, Spacing } from "@/constants/theme";
import type { useAccount } from "@/lib/account/use-account";

type SignInState = Pick<
  ReturnType<typeof useAccount>,
  "available" | "busy" | "error" | "ready" | "signInWithApple"
>;

export function AppleSignInAction({ state }: { state: SignInState }) {
  const network = useNetworkState();
  // Offline, the device never becomes ready, so say so instead of spinning until the sheet is dismissed.
  const offline = network.isConnected === false || network.isInternetReachable === false;
  return (
    <View style={styles.root}>
      {state.busy ? (
        <View style={styles.progress}>
          <LoadingRing accessibilityLabel="Signing in…" color={Gallery.accent} />
        </View>
      ) : state.available && state.ready ? (
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
          buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
          cornerRadius={8}
          style={styles.button}
          onPress={() => {
            void state.signInWithApple();
          }}
        />
      ) : !state.ready && offline ? (
        <Text style={styles.footnote}>Connect to the internet to sign in.</Text>
      ) : !state.ready ? (
        <View style={styles.progress}>
          <LoadingRing accessibilityLabel="Connecting to your account" />
        </View>
      ) : (
        <Text style={styles.footnote}>Apple sign-in is unavailable on this device.</Text>
      )}
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
  button: { width: "100%", height: 50 },
  progress: { minHeight: 50, alignItems: "center", justifyContent: "center" },
  footnote: { fontSize: 13, lineHeight: 18, color: Gallery.muted, textAlign: "center" },
  error: { fontSize: 14, lineHeight: 20, color: Gallery.destructive },
});
