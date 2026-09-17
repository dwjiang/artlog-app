import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '../../../convex/_generated/api';
import { Gallery } from '@/constants/theme';
import { useSocialQuery } from '@/lib/social/use-social-query';
import { useSocialSession } from '@/lib/social/use-social-session';
import { ProfileAvatar } from '../social/profile-avatar';

/** Whose settings these are: the public profile when one exists, otherwise the guest or sign-in state. */
export function SettingsIdentity() {
  const session = useSocialSession();
  const profile = useSocialQuery(api.profiles.mine, session.status === 'ready' ? {} : 'skip', session.key);
  const person = profile.data;
  const target = person ? '/edit-profile' as const : session.status === 'profile-required' ? '/create-profile' as const : undefined;
  const status = person ? 'Public profile' : session.status === 'signed-out' ? 'Guest' : session.status === 'profile-required' ? 'No profile yet'
    : session.status === 'offline' ? 'Offline' : undefined;
  const detail = person ? `@${person.username}` : DETAILS[session.status] ?? 'Checking your account…';
  const content = <>
    <ProfileAvatar name={person?.name ?? 'You'} photoUrl={person?.photoUrl} size={40} />
    <View style={styles.copy}>
      <Text numberOfLines={1} style={styles.name}>{person?.name ?? (session.status === 'profile-required' ? 'Create your profile' : 'Your collection')}</Text>
      <Text numberOfLines={2} style={styles.detail}>{detail}</Text>
    </View>
    {status && <Text style={styles.status}>{status}</Text>}
  </>;
  return target ? <Pressable accessibilityRole="button" accessibilityLabel={person ? 'Edit your profile' : 'Create your profile'} onPress={() => router.push(target)}
    style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}>{content}</Pressable> : <View style={styles.row}>{content}</View>;
}

const DETAILS: Partial<Record<ReturnType<typeof useSocialSession>['status'], string>> = {
  'signed-out': 'Scan, collect, and browse public walls without signing in.',
  'profile-required': 'Friends and sharing need a public profile.',
  offline: 'Your collection still works here. Profile details return when you’re back online.',
  error: 'Your account couldn’t be checked. Try again later.',
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  copy: { flex: 1, gap: 3 },
  name: { fontSize: 15, lineHeight: 20, fontWeight: '500', color: Gallery.ink },
  detail: { fontSize: 11, lineHeight: 17, color: Gallery.muted },
  status: { fontSize: 10, lineHeight: 14, paddingVertical: 5, paddingHorizontal: 8, borderRadius: 999, backgroundColor: '#E1E7D9', color: '#56664B' },
});
