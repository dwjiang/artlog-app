import { StyleSheet, View } from "react-native";

import { GalleryButton } from "@/components/collection/gallery-button";
import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import { FAILED_TITLE, failureCopy } from "@/lib/result/failure-copy";

export const RETRY_BUTTON = "Try again";

export type FailedCardProps = {
  error?: string | null;
  onRetry?: () => void;
  retrying?: boolean;
};

export function FailedCard({
  error,
  onRetry,
  retrying = false,
}: FailedCardProps) {
  return (
    <>
      <View style={styles.section}>
        <ThemedText type="title">{FAILED_TITLE}</ThemedText>
        <ThemedText themeColor="textSecondary">{failureCopy(error)}</ThemedText>
        <ThemedText themeColor="textSecondary">
          Your photo is still here. Try again or keep it for later.
        </ThemedText>
      </View>
      {onRetry && (
        <GalleryButton
          label={RETRY_BUTTON}
          busy={retrying}
          busyLabel="Retrying…"
          disabled={retrying}
          variant="filled"
          fullWidth
          onPress={onRetry}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two },
});
