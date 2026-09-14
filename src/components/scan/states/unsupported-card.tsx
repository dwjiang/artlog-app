import { Button, Host } from '@expo/ui';
import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { SaveAnywayForm, type SaveAnywayFormProps } from './save-anyway-form';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

// Product voice: an older client's scans wait for the update, which re-embeds the kept crop locally.
export const UPDATE_TITLE = 'Update the app to identify this painting';
export const UPDATE_LINE = 'This version can’t identify paintings anymore. Your scan stays on this phone and the updated app will identify it.';
export const UPDATE_BUTTON = 'Update the app';
export const APP_STORE_URL = process.env.EXPO_PUBLIC_APP_STORE_URL ?? 'itms-beta://';

export function UnsupportedCard(save: SaveAnywayFormProps) {
  const [notice, setNotice] = useState<string>();

  function openStore() {
    setNotice(undefined);
    Linking.openURL(APP_STORE_URL).catch(() => setNotice('Couldn’t open the App Store.'));
  }

  return (
    <>
      <View style={styles.section}>
        <ThemedText type="subtitle">{UPDATE_TITLE}</ThemedText>
        <ThemedText themeColor="textSecondary">{UPDATE_LINE}</ThemedText>
      </View>
      <Host matchContents colorScheme="light">
        <Button label={UPDATE_BUTTON} onPress={openStore} />
      </Host>
      {notice && <ThemedText type="small">{notice}</ThemedText>}
      <SaveAnywayForm {...save} />
    </>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two },
});
