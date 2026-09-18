import { signInRoute } from '@/lib/account/sign-in-context';
import { router } from 'expo-router';
import { Pressable, View, useWindowDimensions } from 'react-native';
import { ThemedText as Text } from '@/components/themed-text';
import { api } from '../../../convex/_generated/api';
import { ProfileAvatar } from '../social/profile-avatar';
import { ProfileBio } from '../social/profile-bio';
import { Gallery } from '@/constants/theme';
import { useSocialSession } from '@/lib/social/use-social-session';
import { useSocialQuery } from '@/lib/social/use-social-query';
import { GalleryIconButton } from './gallery-icon-button';
import { useLocalOwner } from '@/lib/account/owner-store';

export function CollectionHeader() {
  const session = useSocialSession();
  const { fontScale, width } = useWindowDimensions();
  const accessibilityLayout = fontScale >= 1.6;
  const stacked = width < 390 || accessibilityLayout;
  const guest = !useLocalOwner().startsWith('account:');
  const { data: profile } = useSocialQuery(api.profiles.mine, session.status === 'ready' ? {} : 'skip', session.key);
  const friends = useSocialQuery(api.profiles.friends, session.status === 'ready' ? {} : 'skip', session.key);
  const edit = () => router.push(profile ? '/edit-profile' : session.status === 'profile-required' ? '/create-profile' : signInRoute('wall'));
  const identity = <>
    <ProfileAvatar name={profile?.name ?? 'Your collection'} photoUrl={profile?.photoUrl} size={40} />
    <Text variant={accessibilityLayout ? 'section' : 'display'} accessibilityRole="header" style={{ flex: accessibilityLayout ? undefined : 1, alignSelf: accessibilityLayout ? 'stretch' : undefined, minWidth: 0, color: Gallery.ink }}>{profile?.name ?? 'Your collection'}</Text>
  </>;
  return <View style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 14, backgroundColor: Gallery.paper }}>
    <View style={{ flexDirection: stacked ? 'column' : 'row', alignItems: stacked ? 'stretch' : 'center', gap: 8 }}>
      {guest ? <View style={{ flex: stacked ? undefined : 1, minWidth: 0, flexDirection: accessibilityLayout ? 'column' : 'row', alignItems: accessibilityLayout ? 'flex-start' : 'center', gap: 10, minHeight: 48 }}>{identity}</View>
        : <Pressable accessibilityRole="button" accessibilityLabel="Edit your profile" onPress={edit} style={{ flex: stacked ? undefined : 1, minWidth: 0, flexDirection: accessibilityLayout ? 'column' : 'row', alignItems: accessibilityLayout ? 'flex-start' : 'center', gap: 10, minHeight: 48 }}>{identity}</Pressable>}
      <View style={{ flexDirection: 'row', gap: 8, alignSelf: 'flex-end' }}>
      <GalleryIconButton label={profile ? 'Share your profile' : 'Share your wall'} icon="square.and.arrow.up" onPress={() => profile ? router.push({ pathname: '/share-profile', params: { profileId: profile.profileId } }) : edit()} />
      <GalleryIconButton label="Settings" icon="gearshape" onPress={() => router.push('/settings')} />
      </View>
    </View>
    {guest && <Text style={{ paddingTop: 4, color: Gallery.muted, fontSize: 13 }}>Saved on this iPhone</Text>}
    {!guest && !profile && <Text style={{ paddingTop: 8, color: Gallery.muted, fontSize: 13, lineHeight: 18 }}>{session.status === 'offline' ? 'Offline · your saved collection is on this iPhone'
      : session.status === 'profile-required' ? 'Create a profile to curate your public wall' : session.status === 'error' ? 'Profile unavailable · your saved collection is still here' : 'Opening your profile…'}</Text>}
    {profile && <Pressable accessibilityRole="button" accessibilityLabel={friends.data?.length ? `${friends.data.length} friends` : 'Find friends'} onPress={() => router.push({ pathname: '/people', params: { filter: 'friends' } })} style={{ minHeight: 44, justifyContent: 'center' }}>
      <Text style={{ color: Gallery.muted, fontSize: 13 }}>@{profile.username} · <Text style={{ color: Gallery.ink, fontWeight: '500' }}>{friends.data?.length ? `${friends.data.length} friends` : 'Find friends'} ›</Text></Text>
    </Pressable>}
    <ProfileBio text={profile?.bio} />
  </View>;
}
