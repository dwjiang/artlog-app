import { Color, useRouter } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";

import { AudioIcon } from "@/components/audio/audio-icon";
import { accessoryStyles, NarrationToggle, narrationStatus, openPlayer } from "@/components/audio/mini-player";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery } from "@/constants/theme";
import { useListening } from "@/lib/audio/use-listening";
import { useVenue } from "@/lib/venue/use-venue";

/** The visit bar while narration is loaded: the visit stays the title and the narration becomes its second line. */
export function VisitPlayerBar() {
  const router = useRouter();
  const audio = useListening();
  const { visit, venue } = useVenue();
  if (!visit || !audio.current) return null;
  const status = narrationStatus(audio);
  const here = visit.venueId === venue?.venueId;
  return (
    <View style={accessoryStyles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open player, ${audio.current.work.title}, ${status}`}
        accessibilityValue={{ text: here ? `Visiting ${visit.venueName}` : `Visit open at ${visit.venueName}` }}
        onPress={() => openPlayer()}
        style={accessoryStyles.summary}
      >
        <AudioIcon name="building.columns.fill" size={22} color={Gallery.accent} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: "600", color: Color.ios.label }}>
            {visit.venueName}
          </Text>
          <View style={styles.narration}>
            <AudioIcon name="waveform" size={12} color={Gallery.accent} />
            {/* The status keeps its width so a long title truncates instead of the time left. */}
            <Text numberOfLines={1} style={[styles.detail, { flexShrink: 1 }]}>
              {audio.current.work.title}
            </Text>
            <Text numberOfLines={1} style={[styles.detail, { flexShrink: 0 }]}>
              {`· ${status}`}
            </Text>
          </View>
        </View>
      </Pressable>
      <NarrationToggle audio={audio} status={status} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="End visit"
        accessibilityHint="Opens a review before saving and ending the visit"
        onPress={() =>
          router.push({
            pathname: "/journal/[visitId]",
            params: { visitId: visit.localId, endVisit: "true" },
          })
        }
        style={({ pressed }) => [styles.end, pressed && { opacity: 0.6 }]}
      >
        <Text style={{ fontSize: 15, color: Gallery.accent }}>End</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  narration: { flexDirection: "row", alignItems: "center", gap: 4 },
  detail: { fontSize: 11, color: Color.ios.secondaryLabel, fontVariant: ["tabular-nums"] },
  end: { minWidth: 44, minHeight: 44, paddingHorizontal: 8, alignItems: "center", justifyContent: "center" },
});
