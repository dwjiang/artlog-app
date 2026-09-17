import * as AppleAuthentication from 'expo-apple-authentication';
import { Image } from 'expo-image';
import { Stack, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GalleryButton } from '@/components/collection/gallery-button';
import { Gallery } from '@/constants/theme';
import { signInContexts, type SignInContext } from '@/lib/account/sign-in-context';
import { useAccount } from '@/lib/account/use-account';

const features = [
  { icon: 'camera.viewfinder', title: 'Scan the label', detail: 'Point at a museum label and the artwork lands in your journal.' },
  { icon: 'square.grid.2x2', title: 'Hang your wall', detail: 'Curate the works that stay with you. Your wall is public; your notes stay private.' },
  { icon: 'person.2', title: 'Follow friends', detail: 'See the visits your friends share, and let them see yours.' },
];

export function SignInScreen({ context = 'account', welcome = false }: { context?: SignInContext; welcome?: boolean }) {
  const { account, available, busy, error, ready, signInWithApple } = useAccount();
  const router = useRouter();
  const { bottom } = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const copy = signInContexts[context];
  useEffect(() => { if (account?.linked && !busy) router.back(); }, [account?.linked, busy, router]);

  return <>
    <Stack.Screen options={{ gestureEnabled: !busy, sheetAllowedDetents: welcome || fontScale > 1.3 ? [1] : [0.45, 1] }} />
    <ScrollView style={styles.root} contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[styles.content, { paddingBottom: Math.max(20, bottom) }, welcome && styles.welcome]}>
      <Text accessibilityRole="header" style={[styles.title, welcome && styles.welcomeTitle]}>{welcome ? 'Welcome to Artlog' : copy.title}</Text>
      {welcome ? <View style={styles.features}>{features.map((feature) => <View key={feature.title} style={styles.feature}>
        <Image source={`sf:${feature.icon}`} tintColor={Gallery.accent} style={styles.symbol} />
        <View style={styles.featureText}><Text style={styles.featureTitle}>{feature.title}</Text><Text style={styles.detail}>{feature.detail}</Text></View>
      </View>)}</View> : <Text style={styles.detail}>{copy.detail}</Text>}
      <View style={[styles.actions, welcome && { marginTop: 'auto' }]}>
        {welcome && <View style={styles.privacy}>
          <Image source="sf:lock.shield" tintColor={Gallery.muted} style={{ width: 20, height: 24 }} />
          <Text style={styles.footnote}>Your saved works and photos stay on this phone. Signing in syncs them to your devices and shares only what you choose.</Text>
        </View>}
        {busy ? <ActivityIndicator accessibilityLabel="Signing in…" color={Gallery.accent} /> : available && ready
          ? <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
            buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
            cornerRadius={10} style={styles.appleButton} onPress={() => { void signInWithApple(); }} />
          : <Text style={styles.footnote}>{!ready ? 'Connecting to your account…' : 'Apple sign-in is unavailable on this device.'}</Text>}
        {error && <Text selectable accessibilityRole="alert" style={styles.error}>{error}</Text>}
        <GalleryButton label="Not now" fullWidth disabled={busy} onPress={() => router.back()} />
      </View>
    </ScrollView>
  </>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Gallery.paper },
  content: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 32, gap: 12 },
  welcome: { paddingTop: 62, gap: 36 },
  title: { fontSize: 24, lineHeight: 29, fontWeight: '700', color: Gallery.ink },
  welcomeTitle: { fontSize: 32, lineHeight: 38, textAlign: 'center', letterSpacing: -0.5 },
  features: { gap: 28 },
  feature: { flexDirection: 'row', gap: 16, alignItems: 'center' },
  symbol: { width: 30, height: 32 },
  featureText: { flex: 1, gap: 4 },
  featureTitle: { fontSize: 17, fontWeight: '600', color: Gallery.ink },
  detail: { fontSize: 15, lineHeight: 22, color: Gallery.muted },
  actions: { gap: 12, paddingTop: 12 },
  appleButton: { width: '100%', height: 50 },
  privacy: { gap: 8, alignItems: 'center', paddingBottom: 12 },
  footnote: { fontSize: 12, lineHeight: 18, color: Gallery.muted, textAlign: 'center' },
  error: { fontSize: 14, lineHeight: 20, color: Gallery.destructive },
});
