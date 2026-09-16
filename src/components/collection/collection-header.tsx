import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { SocialText as Text } from '../social/social-text';
import { api } from '../../../convex/_generated/api';
import { ProfileAvatar } from '../social/profile-avatar';
import { Gallery } from '@/constants/theme';
import { useSocialSession } from '@/lib/social/use-social-session';
import { useSocialQuery } from '@/lib/social/use-social-query';
import { GalleryIconButton } from './gallery-icon-button';

export function CollectionHeader() {
  const session = useSocialSession();
  const { data: profile } = useSocialQuery(api.profiles.mine, session.status === 'ready' ? {} : 'skip', session.key);
  const edit = () => router.push(profile ? '/edit-profile' : session.status === 'profile-required' ? '/create-profile' : '/settings');
  return <View style={{ paddingHorizontal: 18, minHeight: 80, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Gallery.paper }}>
    <Pressable accessibilityRole="button" accessibilityLabel="Edit your profile" onPress={edit}
      style={{ flex: 1, minHeight: 48, flexDirection: 'row', gap: 10, alignItems: 'center' }}>
      <ProfileAvatar name={profile?.name ?? 'Your collection'} photoUrl={profile?.photoUrl} />
      <Text numberOfLines={1} style={{ flex: 1, fontSize: 24, fontWeight: '600', letterSpacing: -0.65, color: Gallery.ink }}>
        {profile?.name ?? 'Your collection'}
      </Text>
    </Pressable>
    <View style={{ flexDirection: 'row', marginRight: -7 }}>
      <GalleryIconButton label="Share your profile" icon="square.and.arrow.up" onPress={() => profile
        ? router.push({ pathname: '/share-profile', params: { profileId: profile.profileId } }) : edit()} />
      <GalleryIconButton label="Settings" icon="gearshape" onPress={() => router.push('/settings')} />
    </View>
  </View>;
}
