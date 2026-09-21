import { StyleSheet, View } from 'react-native';

import { GalleryButton } from '@/components/collection/gallery-button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { ParagraphSkeleton } from '@/components/loading-skeleton';
import { LoadingRing } from '@/components/loading-ring';

// Product voice: the card says "waiting for signal" and asks for the label now.
export const WAITING_TITLE = 'Waiting for signal';
export const WAITING_LINE = 'Capture the label now so we can finish this when you’re back online.';
export const IDENTIFYING_TITLE = 'Finding the story behind the artwork.';
export const IDENTIFYING_LINE = 'Keep this screen open while we look for a match.';
export const LABEL_NOW = 'Point at the label';

export type WaitingForSignalCardProps = {
  status: 'queued' | 'identifying';
  onLabel: () => void;
};

export function WaitingForSignalCard({ status, onLabel }: WaitingForSignalCardProps) {
  const waiting = status === 'queued';
  return (
    <>
      <View style={styles.section}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.compact }}>
          {!waiting && <LoadingRing accessible={false} />}
          <ThemedText type="title" style={{ flex: 1 }}>{waiting ? WAITING_TITLE : IDENTIFYING_TITLE}</ThemedText>
        </View>
        <ThemedText themeColor="textSecondary">{waiting ? WAITING_LINE : IDENTIFYING_LINE}</ThemedText>
      </View>
      {!waiting && <ParagraphSkeleton />}
      <GalleryButton label={LABEL_NOW} variant="filled" fullWidth onPress={onLabel} />
    </>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two },
});
