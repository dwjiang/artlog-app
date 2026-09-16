import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { SocialText as Text } from '../social/social-text';
import { api } from '../../../convex/_generated/api';
import { ProfileAvatar } from '../social/profile-avatar';
import { ProfileBio } from '../social/profile-bio';
import { Gallery } from '@/constants/theme';
import { useSocialSession } from '@/lib/social/use-social-session';
import { useSocialQuery } from '@/lib/social/use-social-query';
import { GalleryIconButton } from './gallery-icon-button';

export function CollectionHeader() {
  const session = useSocialSession();
  const { data: profile } = useSocialQuery(api.profiles.mine, session.status === 'ready' ? {} : 'skip', session.key);
  const friends = useSocialQuery(api.profiles.friends, session.status === 'ready' ? {} : 'skip', session.key);
  const edit = () => router.push(profile ? '/edit-profile' : session.status === 'profile-required' ? '/create-profile' : '/settings');
  return <View style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 20, gap: 13, backgroundColor: Gallery.paper }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Edit your profile" onPress={edit}><ProfileAvatar name={profile?.name ?? 'Your collection'} photoUrl={profile?.photoUrl} size={52} /></Pressable>
      <Text numberOfLines={1} style={{ flex: 1, fontSize: 25, fontWeight: '600', letterSpacing: -0.65, color: Gallery.ink }}>{profile?.name ?? 'Your collection'}</Text>
      <GalleryIconButton label="Edit profile" icon="pencil" onPress={edit} />
      <GalleryIconButton label="Share your profile" icon="square.and.arrow.up" onPress={() => profile ? router.push({ pathname: '/share-profile', params: { profileId: profile.profileId } }) : edit()} />
      <GalleryIconButton label="Settings" icon="gearshape" onPress={() => router.push('/settings')} />
    </View>
    {profile && <Pressable accessibilityRole="button" accessibilityLabel={`${friends.data?.length ?? 0} friends`} onPress={() => router.push({ pathname: '/people', params: { filter: 'friends' } })}>
      <Text style={{ color: Gallery.muted, fontSize: 12 }}>@{profile.username} · <Text style={{ color: Gallery.accent }}>{friends.data?.length ?? 0} friends</Text></Text>
    </Pressable>}
    <ProfileBio text={profile?.bio} />
  </View>;
}
