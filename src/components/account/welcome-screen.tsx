import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { ThemedText as Text } from '@/components/themed-text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GalleryButton } from '@/components/collection/gallery-button';
import { Gallery } from '@/constants/theme';
import { signInRoute } from '@/lib/account/sign-in-context';

const features = [
  { icon: 'camera.viewfinder', title: 'Scan the label', detail: 'Point at a museum label to remember the artwork.' },
  { icon: 'square.grid.2x2', title: 'Keep your collection', detail: 'Save the art that stays with you, right on this iPhone.' },
  { icon: 'building.columns', title: 'Remember your visits', detail: 'Keep a personal journal of museums, artworks, and private notes.' },
];

export function WelcomeScreen() {
  const router = useRouter();
  const { bottom } = useSafeAreaInsets();
  const { height, fontScale } = useWindowDimensions();
  const portraitSize = Math.min(192, Math.max(96, height * 0.22));
  return <ScrollView style={styles.root} contentInsetAdjustmentBehavior="automatic"
    contentContainerStyle={[styles.content, { paddingBottom: Math.max(20, bottom) }]}>
    <View style={styles.brand}>
      <Image source={require('../../../assets/images/icon.png')} accessible={false} style={{ width: portraitSize, height: portraitSize, borderRadius: portraitSize * 0.22 }} contentFit="contain" />
      <Text accessibilityRole="header" accessibilityLabel="Welcome to Artlog" variant={fontScale > 1.4 ? 'display' : 'wordmark'} style={styles.title}>Artlog</Text>
    </View>
    <View style={styles.features}>{features.map((feature) => <View key={feature.title} style={styles.feature}>
      <Image source={`sf:${feature.icon}`} tintColor={Gallery.accent} style={styles.symbol} />
      <View style={styles.featureText}><Text style={styles.featureTitle}>{feature.title}</Text><Text style={styles.detail}>{feature.detail}</Text></View>
    </View>)}</View>
    <View style={styles.actions}>
      <Text style={styles.privacy}>Your collection is private. You choose what to share.</Text>
      <GalleryButton label="Start exploring" fullWidth variant="filled" onPress={() => router.back()} />
      <Text style={styles.footnote}>No account needed</Text>
      <GalleryButton label="Sign in" fullWidth onPress={() => router.replace(signInRoute('account'))} />
    </View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Gallery.paper },
  content: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 24, gap: 24 },
  brand: { alignItems: 'center', gap: 16 },
  title: { textAlign: 'center', color: Gallery.ink },
  features: { gap: 16 },
  feature: { flexDirection: 'row', gap: 16, alignItems: 'center' },
  symbol: { width: 30, height: 32 },
  featureText: { flex: 1, gap: 4 },
  featureTitle: { fontSize: 17, fontWeight: '600', color: Gallery.ink },
  detail: { fontSize: 15, lineHeight: 22, color: Gallery.muted },
  actions: { gap: 8, paddingTop: 12, marginTop: 'auto' },
  privacy: { fontSize: 13, lineHeight: 18, color: Gallery.muted, textAlign: 'center', paddingBottom: 12 },
  footnote: { fontSize: 13, lineHeight: 18, color: Gallery.muted, textAlign: 'center' },
});
