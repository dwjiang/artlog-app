import { StyleSheet, View } from 'react-native';

import { GalleryButton } from '@/components/collection/gallery-button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { LoadingRing } from '@/components/loading-ring';

// Product voice: the card says "waiting for signal" and asks for the label now.
export const WAITING_TITLE = 'Waiting for signal';
export const WAITING_LINE = 'Capture the label now so we can finish this when you’re back online.';
export const IDENTIFYING_TITLE = 'Identifying…';
export const IDENTIFYING_LINE = 'This scan is being sent now. The label still helps if it isn’t in our index yet.';
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
          <ThemedText type="subtitle" style={{ flex: 1 }}>{waiting ? WAITING_TITLE : IDENTIFYING_TITLE}</ThemedText>
        </View>
        <ThemedText themeColor="textSecondary">{waiting ? WAITING_LINE : IDENTIFYING_LINE}</ThemedText>
      </View>
      <GalleryButton label={LABEL_NOW} variant="filled" fullWidth onPress={onLabel} />
    </>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two },
});
