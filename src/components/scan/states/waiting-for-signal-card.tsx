import { StyleSheet, View } from "react-native";

import { GalleryButton } from "@/components/collection/gallery-button";
import { LoadingRing } from "@/components/loading-ring";
import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";

export const WAITING_TITLE = "Waiting for signal";
export const WAITING_LINE = "Your scan will resume when you’re online. You can save the photo now or scan its label.";
export const IDENTIFYING_TITLE = "Identifying artwork…";
export const IDENTIFYING_LINE = "Looking for a match. You can save your photo while we finish.";
export const LABEL_NOW = "Point at the label";

export type WaitingForSignalCardProps = {
  status: "queued" | "identifying";
  onLabel: () => void;
};

export function WaitingForSignalCard({ status, onLabel }: WaitingForSignalCardProps) {
  const waiting = status === "queued";
  return (
    <>
      <View style={styles.section}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: Spacing.compact,
          }}
        >
          {waiting ? (
            <ThemedText type="title" style={{ flex: 1 }}>
              {WAITING_TITLE}
            </ThemedText>
          ) : (
            <>
              <LoadingRing accessibilityLabel={IDENTIFYING_TITLE} />
              <ThemedText type="subtitle" style={{ flex: 1 }}>
                {IDENTIFYING_TITLE}
              </ThemedText>
            </>
          )}
        </View>
        <ThemedText themeColor="textSecondary">{waiting ? WAITING_LINE : IDENTIFYING_LINE}</ThemedText>
      </View>
      <GalleryButton label={LABEL_NOW} icon="text.viewfinder" variant="outlined" fullWidth onPress={onLabel} />
    </>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two },
});
