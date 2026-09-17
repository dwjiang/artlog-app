import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { GalleryButton } from '@/components/collection/gallery-button';
import { Gallery } from '@/constants/theme';
import { getSetting, setSetting } from '@/db/repos/settings';
import { signInRoute } from '@/lib/account/sign-in-context';

export function SignInPromo() {
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    let active = true;
    void getSetting('sign-in-promo-dismissed').then((value) => { if (active) setVisible(value !== 'true'); })
      .catch(() => { if (active) setVisible(true); });
    return () => { active = false; };
  }, []);
  async function dismiss() {
    setVisible(false); setError(undefined);
    try { await setSetting('sign-in-promo-dismissed', 'true'); }
    catch { setVisible(true); setError('Couldn’t save your choice. Try again.'); }
  }
  if (!visible) return null;
  return <View style={styles.card}>
    <View style={styles.heading}>
      <Image source="sf:person.2" tintColor={Gallery.accent} style={{ width: 28, height: 28 }} />
      <View style={{ flex: 1, gap: 3 }}><Text style={styles.title}>Art is better together.</Text>
        <Text style={styles.detail}>Sign in to follow friends and share your own visits.</Text></View>
    </View>
    <View style={styles.actions}><GalleryButton label="Sign in" variant="filled" capsule onPress={() => router.push(signInRoute('friends'))} />
      <GalleryButton label="Not now" onPress={() => { void dismiss(); }} /></View>
    {error && <Text accessibilityRole="alert" style={styles.detail}>{error}</Text>}
  </View>;
}

const styles = StyleSheet.create({
  card: { margin: 18, padding: 16, gap: 8, borderRadius: 20, borderCurve: 'continuous', backgroundColor: Gallery.surface },
  heading: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  title: { fontSize: 15, fontWeight: '600', color: Gallery.ink },
  detail: { fontSize: 12, lineHeight: 18, color: Gallery.muted },
  actions: { flexDirection: 'row', gap: 16, alignItems: 'center' },
});
