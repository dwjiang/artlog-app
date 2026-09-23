import type { ReactNode } from "react";
import { StyleSheet } from "react-native";

import { GlassSurface } from "@/components/glass-surface";
import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";

/** A caption legible over any scene: bold white text on a scrim capsule. */
export function OverlayCaption({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <GlassSurface style={styles.caption}>
      {typeof children === "string" ? (
        <ThemedText type="smallBold" themeColor="overlayText" style={styles.captionText}>
          {children}
        </ThemedText>
      ) : (
        children
      )}
      {hint && (
        <ThemedText type="small" themeColor="overlayText" style={styles.captionText}>
          {hint}
        </ThemedText>
      )}
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  caption: {
    alignSelf: "center",
    alignItems: "center",
    gap: Spacing.half,
    maxWidth: "90%",
    minHeight: 44,
    justifyContent: "center",
    borderRadius: Spacing.four,
    overflow: "hidden",
    paddingVertical: Spacing.two + Spacing.half,
    paddingHorizontal: Spacing.three,
  },
  captionText: { textAlign: "center" },
});
