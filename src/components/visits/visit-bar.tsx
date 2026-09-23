import { TextSkeleton } from "@/components/loading-skeleton";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Gallery, Radius, Spacing, Typography } from "@/constants/theme";
import { useLocalOwner } from "@/lib/account/owner-store";
import { useVisitWorks } from "@/lib/journal/use-visit-works";
import { useVenue } from "@/lib/venue/use-venue";

export function VisitBar() {
  const router = useRouter();
  const owner = useLocalOwner();
  const { visit } = useVenue();
  const { works, loading, error } = useVisitWorks(visit?.localId, owner);
  if (!visit) return null;
  const count = loading
    ? "Loading artworks"
    : error
      ? "Artwork count unavailable"
      : `${works.length} ${works.length === 1 ? "artwork" : "artworks"}`;
  const visitId = visit.localId;
  return (
    <View style={styles.bar}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Visiting ${visit.venueName}, ${count}`}
        accessibilityHint="Opens the current visit"
        onPress={() => router.push({ pathname: "/journal/[visitId]", params: { visitId } })}
        style={({ pressed }) => [styles.summary, pressed && styles.pressed]}
      >
        <View style={styles.text}>
          {loading ? (
            <TextSkeleton label="Loading visit artwork count" width={150} />
          ) : (
            <ThemedText
              variant="metadata"
              style={{ fontSize: 11, lineHeight: 16 }}
              themeColor="textSecondary"
              numberOfLines={2}
            >
              Visiting now · {count}
              {!error && " saved"}
            </ThemedText>
          )}
          <ThemedText numberOfLines={2} style={styles.name}>
            {visit.venueName}
          </ThemedText>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="End visit"
        onPress={() =>
          router.push({ pathname: "/journal/[visitId]", params: { visitId, endVisit: "true" } })
        }
        style={({ pressed }) => [styles.end, pressed && styles.pressed]}
      >
        <ThemedText variant="metadata" style={styles.endLabel}>
          End visit
        </ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    minHeight: 66,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingLeft: 14,
    paddingRight: 10,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#C8C9C1",
    boxShadow: "0 3px 12px #24271414",
    backgroundColor: Gallery.surface,
    borderRadius: Radius.card,
    borderCurve: "continuous",
  },
  summary: { flex: 1, minHeight: 44, justifyContent: "center" },
  pressed: { opacity: 0.6 },
  text: { gap: Spacing.half },
  name: { ...Typography.secondary, fontSize: 15, lineHeight: 20, fontWeight: "600" },
  end: {
    minHeight: 44,
    paddingHorizontal: Spacing.compact,
    borderRadius: Radius.button,
    borderCurve: "continuous",
    backgroundColor: Gallery.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  endLabel: { color: Gallery.surface, fontSize: 13, lineHeight: 18, fontWeight: "500" },
});
