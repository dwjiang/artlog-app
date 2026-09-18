import * as Clipboard from 'expo-clipboard';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Share, View } from 'react-native';
import { ThemedText as Text } from '@/components/themed-text';
import type { Id } from '../../../convex/_generated/dataModel';
import { api } from '../../../convex/_generated/api';
import { GalleryButton } from '../collection/gallery-button';
import { Gallery } from '@/constants/theme';
import { useSocialQuery } from '@/lib/social/use-social-query';
import { useSocialSession } from '@/lib/social/use-social-session';
import type { PublicProfile } from '@/lib/social/types';
import { ProfileAvatar } from './profile-avatar';
import { SocialGate, SocialState } from './social-state';

export function ShareProfileScreen() {
  const session = useSocialSession(), router = useRouter();
  const { profileId } = useLocalSearchParams<{ profileId?: string }>();
  const profile = useSocialQuery(api.profiles.getPublic, profileId || session.profileId ? { profileId: (profileId ?? session.profileId!) as Id<'profiles'> } : 'skip', session.key);
  if (!profileId && session.status !== 'ready') return <SocialGate session={session} />;
  if (profile.data === null) return <SocialState title="Profile unavailable." detail="This public profile is no longer available."
    action="Back" onAction={() => router.back()} />;
  if (!profile.data) return <SocialState title={profile.error ? 'Couldn’t load your profile.' : 'Opening your profile…'}
    loading={!profile.error} action={profile.error ? 'Try again' : undefined} onAction={profile.refresh} />;
  return <ShareProfileContent key={`${session.key}:${profile.data.profileId}`} person={profile.data} />;
}

function ShareProfileContent({ person }: { person: PublicProfile }) {
  const router = useRouter();
  const [copied, setCopied] = useState(false), [error, setError] = useState<string>();
  const url = `artlog://profile/${person.profileId}`;
  async function copy() {
    try { await Clipboard.setStringAsync(url); setCopied(true); setError(undefined); }
    catch { setError('The link could not be copied. Try again.'); }
  }
  async function share() {
    try { await Share.share({ message: `${person.name}’s Artlog`, url }); setError(undefined); }
    catch { setError('Sharing could not open. Try again.'); }
  }
  return <ScrollView style={{ backgroundColor: Gallery.paper }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, gap: 24, alignItems: 'center' }}>
    <ProfileAvatar name={person.name} photoUrl={person.photoUrl} size={72} />
    <View style={{ alignItems: 'center', gap: 6 }}><Text variant="display" style={{ color: Gallery.ink, textAlign: 'center' }}>{person.name}</Text>
      <Text style={{ fontSize: 13, color: Gallery.muted }}>@{person.username}</Text></View>
    <Text style={{ fontSize: 14, lineHeight: 21, color: Gallery.muted, textAlign: 'center' }}>Share this little museum. Anyone with Artlog can view your wall. Each shared visit uses the audience its owner chooses.</Text>
    <View style={{ padding: 16, borderRadius: 12, backgroundColor: Gallery.fill, width: '100%', gap: 8 }}>
      <Text selectable style={{ fontSize: 13, color: Gallery.ink }}>{url}</Text>
      <GalleryButton label={copied ? 'Copied' : 'Copy link'} icon={copied ? 'checkmark' : 'doc.on.doc'} onPress={() => { void copy(); }} />
    </View>
    <GalleryButton label="Share profile" icon="square.and.arrow.up" variant="filled" fullWidth onPress={() => { void share(); }} />
    <GalleryButton label="View as visitor" icon="arrow.up.right" onPress={() => router.push({ pathname: '/profile/[profileId]', params: { profileId: person.profileId, preview: 'true' } })} />
    {error && <Text accessibilityRole="alert" style={{ color: Gallery.destructive }}>{error}</Text>}
  </ScrollView>;
}
