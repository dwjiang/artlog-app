import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { ThemedText as Text } from '@/components/themed-text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GalleryButton } from '@/components/collection/gallery-button';
import { Gallery } from '@/constants/theme';
import { signInRoute } from '@/lib/account/sign-in-context';

export function WelcomeScreen() {
  const router = useRouter();
  const { top, bottom } = useSafeAreaInsets();
  const { height, fontScale } = useWindowDimensions();
  const portraitSize = Math.min(200, Math.max(120, height * 0.24));
  return <View style={[styles.root, { paddingTop: Math.max(24, top), paddingBottom: Math.max(24, bottom) }]}>
    <View style={styles.brand}>
      <Image source={require('../../../assets/images/icon.png')} accessible={false} contentFit="contain"
        style={{ width: portraitSize, height: portraitSize, borderRadius: portraitSize * 0.22 }} />
      <Text accessibilityRole="header" accessibilityLabel="Welcome to Artlog" variant={fontScale > 1.4 ? 'display' : 'wordmark'} style={styles.title}>Artlog</Text>
      <Text style={styles.tagline}>Remember the art that stays with you.</Text>
    </View>
    <View style={styles.actions}>
      <GalleryButton label="Start exploring" fullWidth variant="filled" onPress={() => router.back()} />
      <GalleryButton label="Sign in" fullWidth onPress={() => router.replace(signInRoute('account'))} />
    </View>
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Gallery.paper, paddingHorizontal: 20, justifyContent: 'space-between' },
  brand: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  title: { textAlign: 'center', color: Gallery.ink },
  tagline: { fontSize: 17, lineHeight: 25, color: Gallery.ink, textAlign: 'center' },
  actions: { gap: 8 },
});
