import { useRouter } from "expo-router";
import { Pressable, View } from "react-native";

import { AudioIcon } from "@/components/audio/audio-icon";
import { ThemedText } from "@/components/themed-text";
import { Gallery } from "@/constants/theme";
import { useLocalOwner } from "@/lib/account/owner-store";
import { formatVisitStart } from "@/lib/journal/history";
import { useVisitWorks } from "@/lib/journal/use-visit-works";
import { useVenue } from "@/lib/venue/use-venue";

export function VisitBar() {
  const router = useRouter();
  const { visit, venue } = useVenue();
  const { works, loading, error } = useVisitWorks(visit?.localId, useLocalOwner());
  if (!visit) return null;
  // Away from its museum the visit is paused, not over: only the person ends it.
  const here = visit.venueId === venue?.venueId;
  const count = loading || error ? undefined : `${works.length} ${works.length === 1 ? "artwork" : "artworks"}`;
  const detail = [here ? "Currently visiting" : "Visit open", formatVisitStart(visit.startedAt, visit.timeZone), count]
    .filter(Boolean)
    .join(" · ");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={here ? `Visiting ${visit.venueName}` : `Visit open at ${visit.venueName}`}
      accessibilityHint="Opens the current visit"
      onPress={() =>
        router.push({
          pathname: "/journal/[visitId]",
          params: { visitId: visit.localId },
        })
      }
      style={({ pressed }) => ({
        minHeight: 44,
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 16,
        gap: 10,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <AudioIcon name="building.columns" size={15} color={Gallery.muted} />
      <View style={{ flex: 1, gap: 1 }}>
        <ThemedText numberOfLines={1} style={{ fontSize: 15, lineHeight: 20, fontWeight: "600" }}>
          {visit.venueName}
        </ThemedText>
        <ThemedText numberOfLines={1} themeColor="textSecondary" style={{ fontSize: 12, lineHeight: 16 }}>
          {detail}
        </ThemedText>
      </View>
      <AudioIcon name="chevron.right" size={12} color={Gallery.muted} />
    </Pressable>
  );
}
