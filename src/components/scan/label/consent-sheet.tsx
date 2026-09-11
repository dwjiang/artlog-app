import { BottomSheet, Button, Host } from '@expo/ui';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

// The legal surface (design §4.5/§5.5): wording changes need the operator's review.
export const CONSENT_TITLE = 'Share this work with other visitors?';
export const CONSENT_BODY =
  'What leaves your phone: a numeric fingerprint of your photo (not the photo), the details read from the label, ' +
  'and a small crop of your own photo of the painting. The crop becomes the thumbnail other visitors see for this work. ' +
  'Full photos never leave your phone. You can withdraw a contribution from Settings.';

export type ConsentSheetProps = { open: boolean; onShare: () => void; onDismiss: () => void };

export function ConsentSheet({ open, onShare, onDismiss }: ConsentSheetProps) {
  return (
    <BottomSheet isPresented={open} onDismiss={onDismiss}>
      <View style={styles.content}>
        <ThemedText type="subtitle">{CONSENT_TITLE}</ThemedText>
        <ThemedText>{CONSENT_BODY}</ThemedText>
        <Host matchContents colorScheme="light">
          <Button label="Share" onPress={onShare} />
        </Host>
        <Host matchContents colorScheme="light">
          <Button variant="outlined" label="Not now" onPress={onDismiss} />
        </Host>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  content: { gap: Spacing.three, paddingBottom: Spacing.four },
});
