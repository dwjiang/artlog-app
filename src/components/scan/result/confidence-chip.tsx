import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Gallery, Spacing } from "@/constants/theme";
import { formatConfidence } from "@/lib/result/confidence";
import type { ResultKind } from "@/lib/result/state";

import type { ConfirmedSource } from "../../../../convex/lib/validators";

// Product voice: a soft match is a "Maybe", never presented as fact.
export const CONFIDENCE_LABELS: Partial<Record<ResultKind, string>> = {
  confident: "Match",
  soft: "Maybe",
  unidentified: "Unidentified",
  unsupported: "Update required",
  failed: "Identification failed",
};
// A confirmed card names the work from the owner's details, so its chip says where they came from.
export const CONFIRMED_LABELS: Record<ConfirmedSource, string> = {
  label: "From the label",
  manual: "Your details",
};
// A linked match has no recognition score; the chip names how the owner found it instead.
export const LINKED_DETAILS: Record<ConfirmedSource, string> = {
  label: "from the label",
  manual: "from your details",
};

export function ConfidenceChip({
  kind,
  probability,
  source,
  style,
}: {
  kind: ResultKind;
  probability?: number;
  source?: ConfirmedSource;
  style?: StyleProp<ViewStyle>;
}) {
  const label = kind === "confirmed" ? source && CONFIRMED_LABELS[source] : CONFIDENCE_LABELS[kind];
  if (!label) return null;
  const named = kind === "confident" || kind === "soft";
  const confidence = !named ? undefined : source ? LINKED_DETAILS[source] : formatConfidence(probability);
  return (
    <View
      accessible
      accessibilityLabel={confidence ? `${label}, ${confidence}` : label}
      style={[
        styles.chip,
        (kind === "confident" || kind === "confirmed") && styles.match,
        kind === "soft" && {
          backgroundColor: "#FFF0D5",
          borderColor: "#C68A24",
        },
        style,
      ]}
    >
      <ThemedText type="smallBold" style={kind === "failed" ? styles.failed : undefined}>
        {label}
      </ThemedText>
      {confidence && (
        <ThemedText type="small" style={styles.confidence}>
          {confidence}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    flexWrap: "wrap",
    maxWidth: "100%",
    alignItems: "baseline",
    gap: Spacing.one,
    paddingHorizontal: Spacing.compact,
    paddingVertical: Spacing.one,
    borderRadius: 3,
    backgroundColor: Gallery.fill,
  },
  match: { backgroundColor: Gallery.highlight },
  failed: { color: Gallery.destructive },
  confidence: { fontVariant: ["tabular-nums"] },
});
