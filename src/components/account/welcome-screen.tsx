import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
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
  return <ScrollView style={styles.root} contentInsetAdjustmentBehavior="automatic"
    contentContainerStyle={[styles.content, { paddingBottom: Math.max(20, bottom) }]}>
    <Text accessibilityRole="header" style={styles.title}>Welcome to Artlog</Text>
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
  content: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 62, gap: 36 },
  title: { fontSize: 32, lineHeight: 38, fontWeight: '700', textAlign: 'center', letterSpacing: -0.5, color: Gallery.ink },
  features: { gap: 28 },
  feature: { flexDirection: 'row', gap: 16, alignItems: 'center' },
  symbol: { width: 30, height: 32 },
  featureText: { flex: 1, gap: 4 },
  featureTitle: { fontSize: 17, fontWeight: '600', color: Gallery.ink },
  detail: { fontSize: 15, lineHeight: 22, color: Gallery.muted },
  actions: { gap: 8, paddingTop: 12, marginTop: 'auto' },
  privacy: { fontSize: 12, lineHeight: 18, color: Gallery.muted, textAlign: 'center', paddingBottom: 12 },
  footnote: { fontSize: 12, lineHeight: 18, color: Gallery.muted, textAlign: 'center' },
});
