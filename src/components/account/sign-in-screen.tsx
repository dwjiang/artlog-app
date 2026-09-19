import { LoadingRing } from '@/components/loading-ring';
import * as AppleAuthentication from 'expo-apple-authentication';
import { Stack, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { ThemedText as Text } from '@/components/themed-text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GalleryButton } from '@/components/collection/gallery-button';
import { GalleryIconButton } from '@/components/collection/gallery-icon-button';
import { Gallery, Typography } from '@/constants/theme';
import { signInContexts, type SignInContext } from '@/lib/account/sign-in-context';
import { useAccount } from '@/lib/account/use-account';

export function SignInScreen({ context = 'account' }: { context?: SignInContext }) {
  const { account, available, busy, error, ready, signInWithApple } = useAccount();
  const router = useRouter();
  const { bottom } = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const copy = signInContexts[context];
  useEffect(() => { if (account?.linked && !busy) router.back(); }, [account?.linked, busy, router]);

  return <>
    <Stack.Screen options={{ gestureEnabled: !busy, sheetAllowedDetents: fontScale > 1.3 ? [1] : [0.45, 1] }} />
    <ScrollView style={styles.root} contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[styles.content, { paddingBottom: Math.max(20, bottom) }]}>
      <View style={styles.heading}>
        <Text accessibilityRole="header" style={styles.title}>{copy.title}</Text>
        <GalleryIconButton label="Close sign-in" icon="xmark" disabled={busy} onPress={() => router.back()} />
      </View>
      <Text style={styles.detail}>{copy.detail}</Text>
      <View style={styles.actions}>
        {busy ? <LoadingRing accessibilityLabel="Signing in…" color={Gallery.accent} /> : available && ready
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
  content: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 32, gap: 12 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { ...Typography.display, flex: 1, color: Gallery.ink },
  detail: { fontSize: 15, lineHeight: 22, color: Gallery.muted },
  actions: { gap: 12, paddingTop: 12 },
  appleButton: { width: '100%', height: 50 },
  footnote: { fontSize: 13, lineHeight: 18, color: Gallery.muted, textAlign: 'center' },
  error: { fontSize: 14, lineHeight: 20, color: Gallery.destructive },
});
