import { StyleSheet, View } from 'react-native';

import { GalleryButton } from '@/components/collection/gallery-button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { FAILED_TITLE, failureCopy } from '@/lib/result/failure-copy';

export const RETRY_BUTTON = 'Retry';

export type FailedCardProps = {
  error?: string | null;
  /** Given for a scan still on this phone; a scan the server already answered cannot be rerun from the card. */
  onRetry?: () => void;
};

export function FailedCard({ error, onRetry }: FailedCardProps) {
  return (
    <>
      <View style={styles.section}>
        <ThemedText type="subtitle">{FAILED_TITLE}</ThemedText>
        <ThemedText themeColor="textSecondary">{failureCopy(error)}</ThemedText>
      </View>
      {onRetry && <GalleryButton label={RETRY_BUTTON} variant="filled" fullWidth onPress={onRetry} />}
    </>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two },
});
