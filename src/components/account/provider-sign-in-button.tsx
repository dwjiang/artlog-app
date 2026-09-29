import { Image } from "expo-image";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";

import { Gallery, Spacing } from "@/constants/theme";

export const SIGN_IN_BUTTON_HEIGHT = 50;

export function ProviderSignInButton({
  provider,
  disabled,
  busy,
  minHeight = SIGN_IN_BUTTON_HEIGHT,
  onPress,
}: {
  provider: "apple" | "google";
  disabled: boolean;
  busy: boolean;
  minHeight?: number;
  onPress: () => void;
}) {
  const { fontScale } = useWindowDimensions();
  const apple = provider === "apple";
  const label = apple ? "Continue with Apple" : "Continue with Google";
  const logoHeight = SIGN_IN_BUTTON_HEIGHT * fontScale;
  // Apple's unmodified 31 × 44 artwork includes the logo's required clear space.
  const logoWidth = (logoHeight * 31) / 44;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { minHeight },
        apple && styles.appleButton,
        !apple && disabled && styles.googleDisabled,
        (pressed || disabled) && styles.dimmed,
      ]}
    >
      <View pointerEvents="none" style={[styles.logo, { width: logoWidth, height: logoHeight }]}>
        <Image
          source={
            apple ? require("../../../assets/images/apple-sign-in.svg") : require("../../../assets/images/google-g.png")
          }
          contentFit="contain"
          accessible={false}
          style={apple ? { width: logoWidth, height: logoHeight } : { width: 20 * fontScale, height: 20 * fontScale }}
        />
      </View>
      <Text style={[styles.label, apple && styles.appleLabel]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.three,
    width: "100%",
    backgroundColor: Gallery.surface,
    borderWidth: 1,
    borderColor: Gallery.controlBorder,
    borderRadius: 8,
  },
  appleButton: { backgroundColor: "#000000", borderColor: "#000000" },
  googleDisabled: { borderColor: Gallery.separator },
  dimmed: { opacity: 0.5 },
  logo: { alignItems: "center", justifyContent: "center" },
  label: {
    flexShrink: 1,
    color: Gallery.ink,
    fontSize: SIGN_IN_BUTTON_HEIGHT * 0.43,
    fontWeight: "500",
    textAlign: "center",
  },
  appleLabel: { color: "#FFFFFF" },
});
