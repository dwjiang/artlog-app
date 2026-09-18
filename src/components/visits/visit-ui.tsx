import type { ReactNode } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { ThemedText as Text } from '@/components/themed-text';
import { Image } from 'expo-image';
import { Gallery, Typography } from '@/constants/theme';
import { GalleryButton } from '../collection/gallery-button';
import { SavedWorkImage } from '../collection/saved-work-image';
import { cropSyncing } from '@/lib/account/photo-sync';
import type { SavedWork } from '@/db/schema';

export function VisitMessage({ children, loading, action, onAction }: { children: ReactNode; loading?: boolean; action?: string; onAction?: () => void }) {
  return <View style={visitStyles.section}>
    {loading && <ActivityIndicator accessibilityLabel="Loading visits" color={Gallery.accent} />}
    <Text style={[visitStyles.body, loading && visitStyles.loadingMessage]}>{children}</Text>
    {action && onAction && <GalleryButton label={action} onPress={onAction} />}
  </View>;
}
export function VisitPage({ children }: { children: ReactNode }) {
  return <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive"
    automaticallyAdjustKeyboardInsets style={visitStyles.page} contentContainerStyle={visitStyles.content}>{children}</ScrollView>;
}
export function VisitSymbol({ name, size = 14, color = Gallery.muted }: { name: string; size?: number; color?: string }) {
  return <Image source={`sf:${name}`} tintColor={color} style={{ width: size, height: size }} />;
}
export function VisitPrivacyNote() {
  return <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: 20, paddingVertical: 20 }}>
    <VisitSymbol name="lock" size={12} color={Gallery.muted} />
    <Text style={[visitStyles.fine, { flex: 1 }]}>Your visits are private until you choose to share one.</Text>
  </View>;
}
export function ArtworkPreviews({ works, size = 42, limit = 5, overflow = false }: { works: SavedWork[]; size?: number; limit?: number; overflow?: boolean }) {
  const unique = [...new Map(works.map((work) => [`${work.owner}:${work.localId}`, work])).values()];
  const hidden = unique.length - limit;
  return <View style={visitStyles.previews}>{unique.slice(0, limit).map((work) => <View key={`${work.owner}:${work.localId}`}
    style={[visitStyles.thumbnail, { width: size, height: size }]}>
    <SavedWorkImage path={work.cropPath} syncing={cropSyncing(work)} title={work.title} contain style={{ width: '100%', height: '100%' }} />
  </View>)}
    {overflow && hidden > 0 && <View accessibilityLabel={`${hidden} more ${hidden === 1 ? 'artwork' : 'artworks'}`} style={[visitStyles.more, { height: size }]}>
      <Text style={visitStyles.moreLabel}>+{hidden}</Text></View>}
  </View>;
}
export const visitStyles = StyleSheet.create({
  page: { flex: 1, backgroundColor: Gallery.paper },
  content: { padding: 20, paddingBottom: 40, gap: 16 },
  section: { padding: 20, gap: 12 },
  title: { ...Typography.display, color: Gallery.ink },
  heading: { fontSize: 20, lineHeight: 26, fontWeight: '600', color: Gallery.ink },
  body: { fontSize: 17, lineHeight: 25, color: Gallery.ink },
  loadingMessage: { textAlign: 'center' },
  caption: { fontSize: 13, lineHeight: 18, color: Gallery.muted },
  card: { padding: 16, gap: 10, backgroundColor: Gallery.paper, borderTopWidth: StyleSheet.hairlineWidth, borderColor: Gallery.separator },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  previews: { flexDirection: 'row', gap: 5, flexWrap: 'wrap' },
  thumbnail: { backgroundColor: Gallery.fill, borderRadius: 2 },
  more: { minWidth: 32, paddingHorizontal: 6, borderRadius: 7, backgroundColor: Gallery.fill, alignItems: 'center', justifyContent: 'center' },
  moreLabel: { fontSize: 13, color: Gallery.muted },
  eyebrow: { fontSize: 13, lineHeight: 18, fontWeight: '500', letterSpacing: 1.1, textTransform: 'uppercase', color: Gallery.muted },
  fine: { fontSize: 13, lineHeight: 18, color: Gallery.muted },
  sectionLabel: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, borderTopWidth: StyleSheet.hairlineWidth, borderColor: Gallery.separator, paddingTop: 15, paddingBottom: 8 },
  input: { color: Gallery.ink, backgroundColor: Gallery.surface, padding: 14, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth,
    borderColor: Gallery.controlBorder, fontSize: 17, minHeight: 44 },
  reflection: { minHeight: 105, textAlignVertical: 'top' },
  error: { fontSize: 15, lineHeight: 22, color: Gallery.destructive },
});
