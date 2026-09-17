import type { ReactNode } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Gallery } from '@/constants/theme';
import { GalleryButton } from '../collection/gallery-button';
import { SavedWorkImage } from '../collection/saved-work-image';
import type { SavedWork } from '@/db/schema';

export function VisitMessage({ children, loading, action, onAction }: { children: ReactNode; loading?: boolean; action?: string; onAction?: () => void }) {
  return <View style={visitStyles.section}>
    {loading && <ActivityIndicator accessibilityLabel="Loading visits" color={Gallery.accent} />}
    <Text style={visitStyles.body}>{children}</Text>
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
  return <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: 18, paddingVertical: 20 }}>
    <VisitSymbol name="lock" size={12} color="#78816D" />
    <Text style={[visitStyles.fine, { flex: 1 }]}>Your visits are private until you choose to share one.</Text>
  </View>;
}
export function ArtworkPreviews({ works, size = 42, limit = 5, overflow = false }: { works: SavedWork[]; size?: number; limit?: number; overflow?: boolean }) {
  const unique = [...new Map(works.map((work) => [`${work.owner}:${work.localId}`, work])).values()];
  const hidden = unique.length - limit;
  return <View style={visitStyles.previews}>{unique.slice(0, limit).map((work) => <View key={`${work.owner}:${work.localId}`}
    style={[visitStyles.thumbnail, { width: size, height: size }]}>
    <SavedWorkImage path={work.cropPath} title={work.title} contain style={{ width: '100%', height: '100%' }} />
  </View>)}
    {overflow && hidden > 0 && <View accessibilityLabel={`${hidden} more ${hidden === 1 ? 'artwork' : 'artworks'}`} style={[visitStyles.more, { height: size }]}>
      <Text style={visitStyles.moreLabel}>+{hidden}</Text></View>}
  </View>;
}
export const visitStyles = StyleSheet.create({
  page: { flex: 1, backgroundColor: Gallery.paper },
  content: { padding: 20, paddingBottom: 40, gap: 16 },
  section: { padding: 20, gap: 12 },
  title: { fontSize: 28, fontWeight: '600', color: Gallery.ink },
  heading: { fontSize: 17, fontWeight: '600', color: Gallery.ink },
  body: { fontSize: 14, lineHeight: 21, color: Gallery.ink },
  caption: { fontSize: 12, lineHeight: 20, color: Gallery.muted },
  card: { padding: 16, gap: 10, backgroundColor: Gallery.surface, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: Gallery.separator },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  previews: { flexDirection: 'row', gap: 5, flexWrap: 'wrap' },
  thumbnail: { padding: 4, backgroundColor: '#E5E6DE', borderRadius: 4 },
  more: { minWidth: 32, paddingHorizontal: 6, borderRadius: 7, backgroundColor: '#DDE2D4', alignItems: 'center', justifyContent: 'center' },
  moreLabel: { fontSize: 11, color: '#59664D' },
  eyebrow: { fontSize: 10, lineHeight: 16, fontWeight: '500', letterSpacing: 1.1, textTransform: 'uppercase', color: Gallery.muted },
  fine: { fontSize: 11, lineHeight: 17, color: '#78816D' },
  sectionLabel: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, borderTopWidth: StyleSheet.hairlineWidth, borderColor: Gallery.separator, paddingTop: 15, paddingBottom: 8 },
  input: { color: Gallery.ink, backgroundColor: Gallery.surface, padding: 14, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth,
    borderColor: Gallery.separator, fontSize: 14, minHeight: 44 },
  reflection: { minHeight: 105, textAlignVertical: 'top' },
  error: { fontSize: 15, lineHeight: 22, color: Gallery.destructive },
});
