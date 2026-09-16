import * as Clipboard from 'expo-clipboard';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Share, Text, View } from 'react-native';
import type { Id } from '../../../convex/_generated/dataModel';
import { api } from '../../../convex/_generated/api';
import { GalleryButton } from '../collection/gallery-button';
import { Gallery } from '@/constants/theme';
import { useSocialQuery } from '@/lib/social/use-social-query';
import { useSocialSession } from '@/lib/social/use-social-session';
import { ProfileAvatar } from './profile-avatar';
import { SocialGate, SocialState } from './social-state';

export function ShareProfileScreen() {
  const session = useSocialSession(), router = useRouter();
  const { profileId } = useLocalSearchParams<{ profileId?: string }>();
  const profile = useSocialQuery(api.profiles.getPublic, profileId || session.profileId ? { profileId: (profileId ?? session.profileId!) as Id<'profiles'> } : 'skip', session.key);
  const [copied, setCopied] = useState(false), [error, setError] = useState<string>();
  if (!profileId && session.status !== 'ready') return <SocialGate session={session} />;
  if (!profile.data) return <SocialState title={profile.error ? 'Couldn’t load your profile.' : 'Opening your profile…'}
    loading={!profile.error} action={profile.error ? 'Try again' : undefined} onAction={profile.refresh} />;
  const person = profile.data, url = `artlog://profile/${person.profileId}`;
  async function copy() {
    try { await Clipboard.setStringAsync(url); setCopied(true); setError(undefined); }
    catch { setError('The link could not be copied. Try again.'); }
  }
  async function share() {
    try { await Share.share({ message: `${person.name}’s Artlog`, url }); setError(undefined); }
    catch { setError('Sharing could not open. Try again.'); }
  }
  return <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 24, gap: 22, alignItems: 'center' }}>
    <ProfileAvatar name={person.name} photoUrl={person.photoUrl} size={72} />
    <View style={{ alignItems: 'center', gap: 6 }}><Text style={{ fontSize: 24, fontWeight: '600', color: Gallery.ink }}>{person.name}</Text>
      <Text style={{ fontSize: 13, color: Gallery.muted }}>@{person.username}</Text></View>
    <Text style={{ fontSize: 14, lineHeight: 21, color: Gallery.muted, textAlign: 'center' }}>Share this little museum. Anyone with Artlog can view your wall. Shared visits are for friends.</Text>
    <View style={{ padding: 16, borderRadius: 12, backgroundColor: Gallery.fill, width: '100%', gap: 8 }}>
      <Text selectable style={{ fontSize: 12, color: Gallery.ink }}>{url}</Text>
      <GalleryButton label={copied ? 'Copied' : 'Copy link'} icon={copied ? 'checkmark' : 'doc.on.doc'} onPress={() => { void copy(); }} />
    </View>
    <GalleryButton label="Share profile" icon="square.and.arrow.up" variant="filled" fullWidth onPress={() => { void share(); }} />
    <GalleryButton label="View as visitor" icon="arrow.up.right" onPress={() => router.push({ pathname: '/profile/[profileId]', params: { profileId: person.profileId, preview: 'true' } })} />
    {error && <Text accessibilityRole="alert" style={{ color: Gallery.ink }}>{error}</Text>}
  </ScrollView>;
}
