import { signInRoute } from '@/lib/account/sign-in-context';
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
import { useLocalOwner } from '@/lib/account/owner-store';

export function CollectionHeader() {
  const session = useSocialSession();
  const guest = !useLocalOwner().startsWith('account:');
  const { data: profile } = useSocialQuery(api.profiles.mine, session.status === 'ready' ? {} : 'skip', session.key);
  const friends = useSocialQuery(api.profiles.friends, session.status === 'ready' ? {} : 'skip', session.key);
  const edit = () => router.push(profile ? '/edit-profile' : session.status === 'profile-required' ? '/create-profile' : signInRoute('wall'));
  const identity = <>
    <ProfileAvatar name={profile?.name ?? 'Your collection'} photoUrl={profile?.photoUrl} size={40} />
    <Text numberOfLines={1} style={{ flex: 1, fontSize: 24, lineHeight: 30, fontWeight: '600', letterSpacing: -0.65, color: Gallery.ink }}>{profile?.name ?? 'Your collection'}</Text>
  </>;
  return <View style={{ paddingHorizontal: 18, paddingTop: 10, paddingBottom: 14, backgroundColor: Gallery.paper }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      {guest ? <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48 }}>{identity}</View>
        : <Pressable accessibilityRole="button" accessibilityLabel="Edit your profile" onPress={edit} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48 }}>{identity}</Pressable>}
      <GalleryIconButton label={profile ? 'Share your profile' : 'Share your wall'} icon="square.and.arrow.up" onPress={() => profile ? router.push({ pathname: '/share-profile', params: { profileId: profile.profileId } }) : edit()} />
      <GalleryIconButton label="Settings" icon="gearshape" onPress={() => router.push('/settings')} />
    </View>
    {guest && <Text style={{ paddingTop: 4, color: Gallery.muted, fontSize: 12 }}>Saved on this iPhone</Text>}
    {profile && <Pressable accessibilityRole="button" accessibilityLabel={friends.data?.length ? `${friends.data.length} friends` : 'Find friends'} onPress={() => router.push({ pathname: '/people', params: { filter: 'friends' } })} style={{ minHeight: 44, justifyContent: 'center' }}>
      <Text style={{ color: Gallery.muted, fontSize: 12 }}>@{profile.username} · <Text style={{ color: Gallery.ink, fontWeight: '500' }}>{friends.data?.length ? `${friends.data.length} friends` : 'Find friends'} ›</Text></Text>
    </Pressable>}
    <ProfileBio text={profile?.bio} />
  </View>;
}
