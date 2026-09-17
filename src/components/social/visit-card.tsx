import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SocialText as Text } from './social-text';
import { DisplayMedia } from '@/components/artwork/display-media';
import { GalleryButton } from '@/components/collection/gallery-button';
import { WallFrame, wallFrameInset } from '@/components/collection/wall-frame';
import { Gallery } from '@/constants/theme';
import { artworkCount, visitDate } from '@/lib/social/presentation';
import type { PublicProfile, SharedArtwork, SharedVisit } from '@/lib/social/types';
import { ProfileAvatar } from './profile-avatar';
import { socialStyles } from './social-styles';

export function ProfileIdentity({ profile, interactive = true }: { profile: PublicProfile; interactive?: boolean }) {
  const router = useRouter();
  const content = <>
    <ProfileAvatar name={profile.name} photoUrl={profile.photoUrl} size={44} />
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={styles.name}>{profile.name}</Text>
      <Text style={socialStyles.caption}>@{profile.username} · {profile.publishedWallCount} artworks</Text>
    </View>
  </>;
  return interactive ? <Pressable accessibilityRole="button" accessibilityLabel={`View ${profile.name}’s profile`}
    onPress={() => router.push({ pathname: '/profile/[profileId]', params: { profileId: profile.profileId } })}
    style={styles.identity}>{content}</Pressable> : <View style={styles.identity}>{content}</View>;
}

export function VisitHeading({ visit }: { visit: SharedVisit }) {
  return <View style={styles.heading}>
    <ProfileIdentity profile={visit.author} />
    <View style={{ gap: 5 }}>
      <Text selectable accessibilityRole="header" style={styles.museum}>{visit.venue.name}</Text>
      <Text style={socialStyles.caption}>{visitDate(visit.visitedOn)}</Text>
    </View>
  </View>;
}

export function VisitArtworks({ artworks, token, compact = false, totalCount }: { totalCount?: number; artworks: SharedArtwork[]; token?: string | null; compact?: boolean }) {
  const [width, setWidth] = useState(0);
  const preview = artworks.slice(0, 3);
  return <View testID="visit-artworks" style={[styles.backdrop, compact && styles.preview]} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
    {width > 0 && preview.map(({ itemId, artwork }, index) => {
      const frame = index === 1 ? 'walnut' : 'gilt';
      const ratio = artwork.media.width > 0 && artwork.media.height > 0 ? artwork.media.width / artwork.media.height : 1;
      const available = Math.max(1, width - (compact ? 26 : 56) - (preview.length - 1) * (compact ? 10 : 16));
      const weights = [1.16, 0.82, 0.85].slice(0, preview.length);
      const column = preview.length === 1 ? available * 0.65 : compact
        ? available * weights[index] / weights.reduce((sum, weight) => sum + weight, 0) : available / preview.length;
      const maxHeight = compact ? 115 * (index === 1 ? 0.84 : index === 2 ? 0.93 : 1) * (ratio < 0.65 ? 0.85 : 1) : 155;
      // Both a complete image and its square failure placeholder fit inside the stage.
      const outerWidth = Math.min(column * (compact ? 0.94 : index === 1 ? 0.84 : 1), maxHeight * Math.min(1, ratio));
      return <View key={itemId} style={compact ? { width: column, alignItems: 'center' } : { paddingTop: index === 1 ? 22 : 0 }}>
        <WallFrame frame={frame} width={outerWidth}>
          <DisplayMedia media={artwork.media} label={artwork.title} token={token}
            width={Math.max(1, outerWidth - wallFrameInset(frame, outerWidth) * 2)} />
        </WallFrame>
      </View>;
    })}
    {!!totalCount && totalCount > preview.length && <View style={{ position: 'absolute', right: 12, bottom: 12, borderRadius: 16, backgroundColor: Gallery.paper, paddingHorizontal: 9, paddingVertical: 5 }}><Text style={{ color: Gallery.ink, fontSize: 12 }}>+{totalCount - preview.length} more</Text></View>}
    {!preview.length && <Text style={socialStyles.caption}>A moment from the museum.</Text>}
  </View>;
}

export function VisitCard({ visit, token }: { visit: SharedVisit; token?: string | null }) {
  const router = useRouter();
  const { fontScale } = useWindowDimensions();
  const openVisit = () => router.push({ pathname: '/visit/[postId]', params: { postId: visit.postId } });
  return <View style={styles.card}>
    <View style={[styles.feedHeading, fontScale > 1.4 && { flexDirection: 'column' }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={`View ${visit.author.name}’s profile`}
        onPress={() => router.push({ pathname: '/profile/[profileId]', params: { profileId: visit.author.profileId } })}
        style={[styles.feedIdentity, fontScale > 1.4 && { flex: 0, width: '100%' }]}>
        <ProfileAvatar name={visit.author.name} photoUrl={visit.author.photoUrl} size={37} />
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={styles.feedName}>{visit.author.name}</Text>
          <Text style={styles.feedMuseum}>visited <Text style={{ fontWeight: '500' }}>{visit.venue.name}</Text></Text>
        </View>
      </Pressable>
      <Text accessibilityLabel={visitDate(visit.visitedOn)} style={styles.feedDate}>{visitDate(visit.visitedOn, undefined, 'short')}{visit.venue.city ? `\n${visit.venue.city}` : ''}</Text>
    </View>
    {!!visit.artworks.page.length && <Pressable accessibilityRole="button" accessibilityLabel={`View ${visit.author.name}’s visit to ${visit.venue.name}`} onPress={openVisit}>
      <VisitArtworks artworks={visit.artworks.page} token={token} compact totalCount={visit.artworkCount} />
    </Pressable>}
    {visit.publishedAt > Date.parse(`${visit.visitedOn}T23:59:59Z`) + 86400000 && <Text style={[styles.feedMeta, { marginTop: 10 }]}>Added later · ordered by visit date</Text>}
    {!!visit.reflection && <Text selectable style={styles.reflection}>{visit.reflection}</Text>}
    <View style={styles.actions}>
      <Text style={styles.feedMeta}>{visit.artworkCount === undefined ? artworkCount(visit.artworks) : `${visit.artworkCount} ${visit.artworkCount === 1 ? 'artwork' : 'artworks'} shared`}</Text>
      <GalleryButton label={visit.artworkCount && visit.artworkCount > 3 ? `View all ${visit.artworkCount} artworks` : 'View visit'} icon="arrow.right" iconPosition="trailing" onPress={openVisit} />
    </View>
  </View>;
}

const styles = StyleSheet.create({
  card: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 11, borderBottomWidth: 0.5, borderBottomColor: Gallery.separator },
  feedHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 13 },
  feedIdentity: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  feedAvatar: { backgroundColor: '#DDE1D8', alignItems: 'center', justifyContent: 'center', borderWidth: 0.5, borderColor: 'rgba(38,35,32,0.04)' },
  feedInitials: { fontSize: 11, fontWeight: '600', letterSpacing: 0.4, color: Gallery.accent },
  feedName: { fontSize: 13, fontWeight: '600', color: Gallery.ink },
  feedMuseum: { fontSize: 12, lineHeight: 18, color: Gallery.ink },
  feedDate: { fontSize: 10, lineHeight: 16, color: Gallery.muted, paddingTop: 3 },
  feedMeta: { fontSize: 10, lineHeight: 16, color: Gallery.muted },
  reflection: { fontFamily: 'Georgia', fontSize: 17, lineHeight: 23, letterSpacing: -0.15, color: '#424238', marginTop: 13, marginBottom: 2 },
  heading: { padding: 20, gap: 18 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  name: { color: Gallery.ink, fontSize: 17, fontWeight: '600' },
  museum: { color: Gallery.ink, fontSize: 21, fontWeight: '500' },
  backdrop: { minHeight: 195, paddingHorizontal: 28, paddingVertical: 20, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 16, backgroundColor: Gallery.sage,
    experimental_backgroundImage: 'linear-gradient(155deg, rgba(255,255,255,0.30) 0%, transparent 55%, rgba(38,35,32,0.08) 100%)' },
  preview: { minHeight: 151, paddingHorizontal: 13, paddingVertical: 18, gap: 10, borderRadius: 8, borderCurve: 'continuous',
    backgroundColor: '#B9BFB6', experimental_backgroundImage: 'linear-gradient(145deg, #BDC3BB 0%, #ADB5AC 100%)' },
  actions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 6 },
});
