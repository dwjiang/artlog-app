import { Image } from 'expo-image';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { captureFileUri } from '@/lib/files/photos';

export function SavedWorkImage({ path, title, style, contain = false }: {
  path: string | null; title: string; style: StyleProp<ViewStyle>; contain?: boolean;
}) {
  return (
    <View style={[styles.container, style]}>
      {path ? <Image source={captureFileUri(path)} contentFit={contain ? 'contain' : 'cover'}
        accessibilityLabel={`Your photo of ${title}`} style={StyleSheet.absoluteFill} />
        : <ThemedText type="small" themeColor="textSecondary" style={styles.placeholder}>Photo syncing…</ThemedText>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  placeholder: { textAlign: 'center', padding: Spacing.two },
});
