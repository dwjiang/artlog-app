import { Image } from "expo-image";
import { StyleSheet, View } from "react-native";

import { ListRow, ListSection } from "@/components/list-row";
import { ThemedText } from "@/components/themed-text";
import { Colors, Gallery, Radius, Typography } from "@/constants/theme";
import { formatConfidence } from "@/lib/result/confidence";
import type { ResultCandidate } from "@/lib/result/state";

import { TentativeOriginNotice } from "./tentative-origin-notice";

export type RunnerUpsProps = {
  candidates: ResultCandidate[];
  onPick: (candidate: ResultCandidate) => void;
  /** The row whose pick is still being saved; every row is disabled meanwhile. */
  busyObjectId?: ResultCandidate["objectId"];
  disabled?: boolean;
};

/** Similar works as rows; a museum thumbnail appears only where the server hotlinked a public-domain one. */
export function RunnerUps({ candidates, onPick, busyObjectId, disabled = false }: RunnerUpsProps) {
  return (
    <ListSection outlined>
      {candidates.map((candidate, index) => {
        const confidence = formatConfidence(candidate.probability);
        const byline = [candidate.artist, candidate.institution].filter(Boolean).join(" · ");
        return (
          <ListRow
            key={candidate.objectId}
            title={candidate.title}
            subtitle={
              <>
                {!!byline && <ThemedText style={styles.subtitle}>{byline}</ThemedText>}
                {confidence && <ThemedText style={[styles.subtitle, styles.confidence]}>{confidence}</ThemedText>}
                {candidate.identityStatus === "tentative" && <TentativeOriginNotice />}
              </>
            }
            leading={
              candidate.thumbnailUrl ? (
                <Image
                  source={candidate.thumbnailUrl}
                  contentFit="cover"
                  accessibilityLabel={`${candidate.identityStatus === "tentative" ? "Visitor" : "Museum"} image of ${candidate.title}`}
                  style={styles.thumbnail}
                />
              ) : (
                <View style={[styles.thumbnail, styles.placeholder]} />
              )
            }
            accessibilityLabel={[candidate.title, candidate.artist, confidence].filter(Boolean).join(", ")}
            accessory="chevron"
            busy={candidate.objectId === busyObjectId}
            disabled={disabled || !!busyObjectId}
            first={index === 0}
            last={index === candidates.length - 1}
            onPress={() => onPick(candidate)}
          />
        );
      })}
    </ListSection>
  );
}

const styles = StyleSheet.create({
  thumbnail: {
    width: 56,
    height: 56,
    borderRadius: Radius.thumbnail,
    backgroundColor: Colors.light.backgroundElement,
  },
  placeholder: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Gallery.separator,
  },
  subtitle: { ...Typography.secondary, color: Gallery.muted },
  confidence: { fontVariant: ["tabular-nums"] },
});
