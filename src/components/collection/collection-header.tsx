import { signInRoute } from '@/lib/account/sign-in-context';
import { router } from 'expo-router';
import { Pressable, View, useWindowDimensions } from 'react-native';
import { ThemedText as Text } from '@/components/themed-text';
import { api } from '../../../convex/_generated/api';
import { ProfileAvatar } from '../social/profile-avatar';
import { Gallery } from '@/constants/theme';
import { useSocialSession } from '@/lib/social/use-social-session';
import { useSocialQuery } from '@/lib/social/use-social-query';
import { GalleryIconButton } from './gallery-icon-button';
import { useLocalOwner } from '@/lib/account/owner-store';
import { Ghost, LoadingSkeleton } from '@/components/loading-skeleton';

export function CollectionHeader({ artworkCount = 0, visitCount = 0, loading = false }: { artworkCount?: number; visitCount?: number; loading?: boolean }) {
  const session = useSocialSession();
  const { fontScale, width } = useWindowDimensions();
  const accessibilityLayout = fontScale >= 1.6;
  const stacked = width < 390 || accessibilityLayout;
  const guest = !useLocalOwner().startsWith('account:');
  const { data: profile } = useSocialQuery(api.profiles.mine, session.status === 'ready' ? {} : 'skip', session.key);
  const edit = () => router.push(profile ? '/edit-profile' : session.status === 'profile-required' ? '/create-profile' : signInRoute('wall'));
  const status = profile ? `@${profile.username}`
    : session.status === 'offline' ? 'Offline · saved on this iPhone' : session.status === 'profile-required' ? 'Create a profile to share your wall'
      : session.status === 'error' ? 'Profile unavailable' : 'Opening your profile…';
  const counts = `${artworkCount} ${artworkCount === 1 ? 'artwork' : 'artworks'} · ${visitCount} ${visitCount === 1 ? 'visit' : 'visits'}`;
  if (guest) return <View style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 14, gap: 4 }}>
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
      <Text variant="display" accessibilityRole="header" accessibilityLabel="Your collection"
        style={{ flex: 1, fontSize: accessibilityLayout ? 32 : 40, lineHeight: accessibilityLayout ? 38 : 46 }}>Your{'\n'}collection</Text>
      {artworkCount > 0 && <GalleryIconButton label="Share your wall" icon="square.and.arrow.up" onPress={edit} />}
      <GalleryIconButton label="Settings" icon="gearshape" onPress={() => router.push('/settings')} />
    </View>
    {loading ? <LoadingSkeleton label="Loading collection counts"><Ghost width={150} style={{ marginTop: 5 }} /></LoadingSkeleton>
      : artworkCount + visitCount > 0 && <Text variant="metadata" themeColor="textSecondary">{counts}</Text>}
  </View>;
  const identity = <>
    <ProfileAvatar name={profile?.name ?? 'Your collection'} photoUrl={profile?.photoUrl} size={accessibilityLayout ? 56 : 76} />
    <View style={{ flex: accessibilityLayout ? undefined : 1, minWidth: 0, gap: 2 }}>
      <Text variant={accessibilityLayout ? 'section' : 'display'} accessibilityRole="header" numberOfLines={2} style={{ color: Gallery.ink }}>{profile?.name ?? 'Your collection'}</Text>
      <Text variant="secondary" style={{ color: Gallery.muted }}>{status}</Text>
      {loading ? <LoadingSkeleton label="Loading collection counts"><Ghost width={150} style={{ marginTop: 5 }} /></LoadingSkeleton>
        : <Text variant="secondary" style={{ color: Gallery.muted }}>{counts}</Text>}
    </View>
  </>;
  const identityStyle = { flex: stacked ? undefined : 1, minWidth: 0, flexDirection: accessibilityLayout ? 'column' as const : 'row' as const,
    alignItems: accessibilityLayout ? 'flex-start' as const : 'center' as const, gap: 14, minHeight: 48 };
  return <View style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 14, backgroundColor: Gallery.paper }}>
    <View style={{ flexDirection: stacked ? 'column' : 'row', alignItems: stacked ? 'stretch' : 'flex-start', gap: 8 }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Edit your profile" onPress={edit} style={identityStyle}>{identity}</Pressable>
      <View style={{ flexDirection: 'row', gap: 4, alignSelf: stacked ? 'flex-end' : 'flex-start' }}>
        <GalleryIconButton label={profile ? 'Share your profile' : 'Share your wall'} icon="square.and.arrow.up" onPress={() => profile ? router.push({ pathname: '/share-profile', params: { profileId: profile.profileId } }) : edit()} />
        <GalleryIconButton label="Settings" icon="gearshape" onPress={() => router.push('/settings')} />
      </View>
    </View>
  </View>;
}
