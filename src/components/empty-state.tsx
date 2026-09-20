import type { ReactNode } from 'react';
import { Image } from 'expo-image';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gallery } from '@/constants/theme';
import { ThemedText as Text } from './themed-text';
import { GalleryButton } from './collection/gallery-button';

export function EmptyState({ title, detail, visual, children, footnote, compact = false, inset = true }: {
  title: string; detail: string; visual?: ReactNode; children?: ReactNode; footnote?: string; compact?: boolean; inset?: boolean;
}) {
  const { fontScale } = useWindowDimensions();
  return <View style={[styles.root, inset && !compact && styles.inset, compact && styles.compact]}>
    {visual}
    <View style={styles.copy}>
      <Text variant="display" accessibilityRole="header" style={compact || !visual ? styles.smallTitle : fontScale > 1.3 ? styles.largeTextTitle : styles.title}>{title}</Text>
      <Text style={styles.detail}>{detail}</Text>
    </View>
    {children && <View style={styles.actions}>{children}</View>}
    {footnote && <Text style={styles.footnote}>{footnote}</Text>}
  </View>;
}

export function EmptySymbol({ name }: { name: string }) {
  return <View accessibilityElementsHidden style={styles.symbol}><Image source={`sf:${name}`} tintColor={Gallery.muted} style={{ width: 30, height: 30 }} accessible={false} /></View>;
}

export function SearchEmptyState({ title = 'Nothing found this time.', detail, onClear }: { title?: string; detail: string; onClear: () => void }) {
  return <View style={styles.search}>
    <EmptySymbol name="magnifyingglass" />
    <Text variant="display" accessibilityRole="header" style={[styles.smallTitle, styles.center]}>{title}</Text>
    <Text style={[styles.detail, styles.center]}>{detail}</Text>
    <GalleryButton label="Clear search" onPress={onClear} />
  </View>;
}

const styles = StyleSheet.create({
  root: { gap: 24, width: '100%', maxWidth: 520, alignSelf: 'center' },
  inset: { paddingHorizontal: 20, paddingTop: 36, paddingBottom: 28 },
  compact: { gap: 12, padding: 20, backgroundColor: Gallery.fill, borderRadius: 8 },
  copy: { gap: 10 },
  title: { fontSize: 40, lineHeight: 46, maxWidth: 330 },
  largeTextTitle: { fontSize: 32, lineHeight: 40 },
  smallTitle: { fontSize: 26, lineHeight: 32 },
  detail: { color: Gallery.muted, fontSize: 15, lineHeight: 23 },
  footnote: { color: Gallery.muted, fontSize: 12, lineHeight: 18 },
  actions: { gap: 8, alignItems: 'flex-start' },
  symbol: { width: 76, height: 76, borderRadius: 38, backgroundColor: Gallery.fill, alignItems: 'center', justifyContent: 'center' },
  search: { padding: 28, gap: 16, alignItems: 'center' },
  center: { textAlign: 'center' },
});
