import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet } from "react-native";

import { GlassSurface } from "@/components/glass-surface";
import { LoadingRing } from "@/components/loading-ring";
import { ThemedText } from "@/components/themed-text";
import { Colors, Spacing } from "@/constants/theme";
import { useVenue, type VenueView } from "@/lib/venue/use-venue";
import { activeVisit } from "@/lib/venue/venue-reducer";

export function venuePillLabel({ status, venue }: Pick<VenueView, "status" | "venue">): string {
  if (venue) return venue.name;
  switch (status) {
    case "choose":
      return "Which museum?";
    case "none":
      return "No museum nearby";
    case "denied":
      return "Location is off";
    default:
      return "Finding your museum…";
  }
}

/**
 * The camera's line about the museum scans match, until the visit band names it: at a museum where a visit can start,
 * or while one is in progress there. Opens the museum chooser.
 */
export function VenuePill() {
  const router = useRouter();
  const view = useVenue();
  if (view.ready || activeVisit(view)) return null;
  const { status, venue } = view;
  const label = venuePillLabel({ status, venue });
  const locating = !venue && (status === "idle" || status === "locating");
  return (
    <GlassSurface isInteractive style={styles.pill}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint="Opens the museum chooser"
        accessibilityState={{ disabled: locating, busy: locating }}
        disabled={locating}
        onPress={() => router.push("/venue-picker")}
        style={({ pressed }) => [styles.content, pressed && styles.pressed]}
      >
        <Image source="sf:building.columns" style={styles.icon} tintColor={Colors.light.overlayText} />
        {locating ? (
          <LoadingRing accessibilityLabel={label} color={Colors.light.overlayText} />
        ) : (
          <ThemedText type="smallBold" themeColor="overlayText" style={styles.label}>
            {label}
          </ThemedText>
        )}
        <Image
          source="sf:chevron.down"
          style={styles.chevron}
          tintColor={Colors.light.overlayText}
          accessible={false}
        />
      </Pressable>
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  pill: { flexShrink: 1, borderRadius: Spacing.four, overflow: "hidden" },
  content: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingVertical: Spacing.two + Spacing.half,
    paddingHorizontal: Spacing.three,
  },
  pressed: { opacity: 0.6 },
  icon: { width: 18, height: 18 },
  chevron: { width: 12, height: 12 },
  label: { flexShrink: 1 },
});
