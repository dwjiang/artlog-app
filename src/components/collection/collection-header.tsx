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
  const { fontScale } = useWindowDimensions();
  const accessibilityLayout = fontScale >= 1.6;
  const guest = !useLocalOwner().startsWith('account:');
  const { data: profile, error: profileError } = useSocialQuery(api.profiles.mine, session.status === 'ready' ? {} : 'skip', session.key);
  const edit = () => router.push(profile ? '/edit-profile' : session.status === 'profile-required' ? '/create-profile' : signInRoute('wall'));
  const status = profile ? `@${profile.username}`
    : session.status === 'offline' ? 'Offline · saved on this iPhone' : session.status === 'profile-required' ? 'Create a profile to share your wall'
      : session.status === 'error' || profileError || profile === null ? 'Profile unavailable' : undefined;
  const counts = `${artworkCount} ${artworkCount === 1 ? 'artwork' : 'artworks'} · ${visitCount} ${visitCount === 1 ? 'visit' : 'visits'}`;
  if (guest) return <View style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 14, gap: 4 }}>
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
      <Text variant="display" accessibilityRole="header" accessibilityLabel="Your collection"
        style={{ flex: 1, fontSize: accessibilityLayout ? 32 : 40, lineHeight: accessibilityLayout ? 38 : 46 }}>Your{'\n'}collection</Text>
      {artworkCount > 0 && <GalleryIconButton label="Share your wall" icon="square.and.arrow.up" onPress={edit} />}
      <GalleryIconButton label="Settings" icon="gearshape" onPress={() => router.push('/settings')} />
    </View>
    <Text variant="metadata" themeColor="textSecondary">Saved on this iPhone</Text>
    {loading ? <LoadingSkeleton label="Loading collection counts"><Ghost width={150} style={{ marginTop: 5 }} /></LoadingSkeleton>
      : artworkCount + visitCount > 0 && <Text variant="metadata" themeColor="textSecondary">{counts}</Text>}
  </View>;
  const identity = status === undefined ? <LoadingSkeleton label="Opening your profile…" style={{ flex: 1 }}><View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
    <Ghost width={64} height={64} round /><View style={{ flex: 1, gap: 10 }}><Ghost width="80%" height={28} /><Ghost width="55%" /></View>
  </View></LoadingSkeleton> : <>
    <ProfileAvatar name={profile?.name ?? 'Your collection'} photoUrl={profile?.photoUrl} size={64} />
    <View style={{ flex: accessibilityLayout ? undefined : 1, minWidth: 0, gap: 2 }}>
      <Text variant={accessibilityLayout ? 'section' : 'display'} accessibilityRole="header" numberOfLines={2} style={{ color: Gallery.ink }}>{profile?.name ?? 'Your collection'}</Text>
      <Text variant="secondary" style={{ color: Gallery.muted }}>{status}</Text>
    </View>
  </>;
  const identityStyle = { flex: 1, minWidth: 0, flexDirection: accessibilityLayout ? 'column' as const : 'row' as const,
    alignItems: accessibilityLayout ? 'flex-start' as const : 'center' as const, gap: 14, minHeight: 48 };
  return <View style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 14, backgroundColor: Gallery.paper }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Edit your profile" onPress={edit} style={identityStyle}>{identity}</Pressable>
        <GalleryIconButton label="Settings" icon="gearshape" onPress={() => router.push('/settings')} />
    </View>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingTop: 8 }}>
      {loading ? <LoadingSkeleton label="Loading collection counts"><Ghost width={150} /></LoadingSkeleton>
        : <Text variant="metadata" style={{ flexShrink: 1, color: Gallery.muted }}>{counts}</Text>}
      <GalleryIconButton label={profile ? 'Share your profile' : 'Share your wall'} icon="square.and.arrow.up" tone="accent" onPress={() => profile ? router.push({ pathname: '/share-profile', params: { profileId: profile.profileId } }) : edit()} />
    </View>
  </View>;
}
