import { reportError } from '@/lib/observability';
import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { SaveAnywayForm, type SaveAnywayFormProps } from './save-anyway-form';
import { GalleryButton } from '@/components/collection/gallery-button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

// Product voice: an older client's scans wait for the update, which re-embeds the kept crop locally.
export const UPDATE_TITLE = 'Update required.';
export const UPDATE_LINE = 'Update Artlog to identify this artwork. Your photo is saved on this iPhone and will be ready when you return.';
export const UPDATE_BUTTON = 'Update the app';
export const APP_STORE_URL = process.env.EXPO_PUBLIC_APP_STORE_URL ?? 'itms-beta://';

export function UnsupportedCard(save: SaveAnywayFormProps) {
  const [notice, setNotice] = useState<string>();

  function openStore() {
    setNotice(undefined);
    Linking.openURL(APP_STORE_URL).catch((error: unknown) => { reportError(error, 'result.open_store', { level: 'warning' }); setNotice('Couldn’t open the App Store.'); });
  }

  return (
    <>
      <View style={styles.section}>
        <ThemedText type="title">{UPDATE_TITLE}</ThemedText>
        <ThemedText themeColor="textSecondary">{UPDATE_LINE}</ThemedText>
      </View>
      <GalleryButton label={UPDATE_BUTTON} variant="filled" fullWidth onPress={openStore} />
      <SaveAnywayForm {...save} compact />
      {notice && <ThemedText type="small">{notice}</ThemedText>}
    </>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two },
});
