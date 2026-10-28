import { Image } from "expo-image";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";

import { LoadingRing } from "@/components/loading-ring";
import { MotionPressable } from "@/components/motion-pressable";
import { Gallery, Radius, Spacing } from "@/constants/theme";

// Matches a full-width filled GalleryButton, so provider buttons sit in the same stack as the app's own actions.
export const SIGN_IN_BUTTON_HEIGHT = 52;
const LABEL_SIZE = 17;
const GOOGLE_LOGO_SIZE = 18;
// Caps Dynamic Type so "Continue" and the Apple logo still share a line inside the narrowest sheet's button, 302
// points on an iPhone 16e; past that the label breaks mid-word.
const MAX_FONT_SCALE = 2.6;

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
  const fontScale = Math.min(useWindowDimensions().fontScale, MAX_FONT_SCALE);
  const apple = provider === "apple";
  const label = apple ? "Continue with Apple" : "Continue with Google";
  // Apple sizes its logo artwork for a title at 43% of the button height, so it follows the title to keep the glyph
  // in proportion. The unmodified 31 × 44 artwork includes the logo's required clear space.
  const logoHeight = Math.round(LABEL_SIZE / 0.43) * fontScale;
  // Google's iOS logo-to-title gap, used for both logos. Apple's artwork already ends in clear space (its glyph stops
  // at x = 23.2 of 31), so its margin is only the remainder.
  const logoGap = Spacing.compact * fontScale;
  const appleClearSpace = (logoHeight / 44) * (31 - 23.2);
  const logoSize = apple
    ? { width: (logoHeight * 31) / 44, height: logoHeight }
    : { width: GOOGLE_LOGO_SIZE * fontScale, height: GOOGLE_LOGO_SIZE * fontScale };
  const dimmed = disabled && !busy;
  return (
    <MotionPressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={[styles.button, { minHeight }, apple && styles.appleButton, dimmed && styles.dimmed]}
    >
      {/* Hidden content keeps the button's size while the ring replaces it. */}
      <View
        pointerEvents="none"
        style={[logoSize, { marginRight: apple ? logoGap - appleClearSpace : logoGap }, busy && styles.hidden]}
      >
        <Image
          source={
            apple ? require("../../../assets/images/apple-sign-in.svg") : require("../../../assets/images/google-g.png")
          }
          contentFit="contain"
          accessible={false}
          style={logoSize}
        />
      </View>
      <Text
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={[styles.label, apple && styles.appleLabel, busy && styles.hidden]}
      >
        {label}
      </Text>
      {busy && (
        <LoadingRing color={apple ? "#FFFFFF" : Gallery.ink} accessible={false} style={StyleSheet.absoluteFill} />
      )}
    </MotionPressable>
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
    borderColor: Gallery.softBorder,
    borderRadius: Radius.button,
  },
  appleButton: { backgroundColor: "#000000", borderColor: "#000000" },
  dimmed: { opacity: 0.5 },
  hidden: { opacity: 0 },
  label: {
    flexShrink: 1,
    color: Gallery.ink,
    fontSize: LABEL_SIZE,
    fontWeight: "600",
    textAlign: "center",
  },
  appleLabel: { color: "#FFFFFF" },
});
