import { TentativeOriginNotice } from "./tentative-origin-notice";
import { Image } from "expo-image";
import { Pressable, StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Colors, Gallery, Spacing } from "@/constants/theme";
import { formatConfidence } from "@/lib/result/confidence";
import type { ResultCandidate } from "@/lib/result/state";

export type RunnerUpsProps = {
  candidates: ResultCandidate[];
  onPick: (candidate: ResultCandidate) => void;
};

/** Similar works as rows; a museum thumbnail appears only where the server hotlinked a public-domain one. */
export function RunnerUps({ candidates, onPick }: RunnerUpsProps) {
  return (
    <View style={styles.list}>
      {candidates.map((candidate) => {
        const confidence = formatConfidence(candidate.probability);
        return (
          <Pressable
            key={candidate.objectId}
            accessibilityRole="button"
            accessibilityLabel={[candidate.title, candidate.artist, confidence]
              .filter(Boolean)
              .join(", ")}
            onPress={() => onPick(candidate)}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            {candidate.thumbnailUrl ? (
              <Image
                source={candidate.thumbnailUrl}
                contentFit="cover"
                accessibilityLabel={`${candidate.identityStatus === "tentative" ? "Visitor" : "Museum"} image of ${candidate.title}`}
                style={styles.thumbnail}
              />
            ) : (
              <View style={[styles.thumbnail, styles.placeholder]} />
            )}
            <View style={styles.text}>
              <ThemedText>{candidate.title}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {[candidate.artist, candidate.institution]
                  .filter(Boolean)
                  .join(" · ")}
              </ThemedText>
              {confidence && (
                <ThemedText
                  type="small"
                  themeColor="textSecondary"
                  style={styles.confidence}
                >
                  {confidence}
                </ThemedText>
              )}
              {candidate.identityStatus === "tentative" && (
                <TentativeOriginNotice />
              )}
            </View>
            <Image
              source="sf:chevron.right"
              tintColor={Gallery.muted}
              style={{ width: 12, height: 12 }}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 0 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Gallery.separator,
  },
  pressed: { opacity: 0.6 },
  thumbnail: {
    width: 56,
    height: 56,
    borderRadius: 2,
    backgroundColor: Colors.light.backgroundElement,
  },
  placeholder: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Gallery.separator,
  },
  text: { flex: 1, gap: Spacing.half },
  confidence: { fontVariant: ["tabular-nums"] },
});
