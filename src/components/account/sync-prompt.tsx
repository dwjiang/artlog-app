import * as AppleAuthentication from 'expo-apple-authentication';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { ThemedText as Text } from '@/components/themed-text';

import { GalleryButton } from '@/components/collection/gallery-button';
import { Gallery } from '@/constants/theme';
import { getSetting, setSetting } from '@/db/repos/settings';
import { useAccount } from '@/lib/account/use-account';

export function SyncPrompt() {
  const { account, available, ready, busy, error, signInWithApple } = useAccount();
  const [visible, setVisible] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [dismissError, setDismissError] = useState<string>();
  useEffect(() => {
    let active = true;
    void getSetting('sync-prompt-dismissed').then((value) => { if (active) setVisible(value !== 'true'); }).catch(() => {});
    return () => { active = false; };
  }, []);

  async function dismiss() {
    setDismissing(true); setDismissError(undefined);
    try { await setSetting('sync-prompt-dismissed', 'true'); setVisible(false); }
    catch { setDismissError('Couldn’t save your choice. Try again.'); }
    finally { setDismissing(false); }
  }

  if (!visible || account?.linked || !available || !ready) return null;
  return <View style={styles.card}>
    <Text accessibilityRole="header" style={styles.title}>Keep your collection across devices</Text>
    <Text style={styles.detail}>Sign in to sync your saved art and visits. Your collection stays private.</Text>
    {busy || dismissing ? <ActivityIndicator accessibilityLabel={busy ? 'Signing in…' : 'Saving preference…'} color={Gallery.accent} style={styles.appleButton} />
      : <AppleAuthentication.AppleAuthenticationButton
        buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
        buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
        cornerRadius={10} style={styles.appleButton} onPress={() => { setDismissError(undefined); void signInWithApple(); }} />}
    <GalleryButton label="Not now" fullWidth disabled={busy || dismissing} onPress={() => { void dismiss(); }} />
    {(dismissError || error) && <Text selectable accessibilityRole="alert" style={styles.error}>{dismissError || error}</Text>}
  </View>;
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 20, marginTop: 24, padding: 16, gap: 10, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: Gallery.separator, backgroundColor: Gallery.paper },
  title: { fontSize: 17, lineHeight: 22, fontWeight: '600', color: Gallery.ink },
  detail: { fontSize: 13, lineHeight: 19, color: Gallery.muted },
  appleButton: { width: '100%', height: 44 },
  error: { fontSize: 13, lineHeight: 19, color: Gallery.destructive },
});
