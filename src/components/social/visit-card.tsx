import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActionSheetIOS, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { ThemedText as Text } from '@/components/themed-text';
import { DisplayMedia } from '@/components/artwork/display-media';
import { GalleryButton } from '@/components/collection/gallery-button';
import { GalleryIconButton } from '@/components/collection/gallery-icon-button';
import { Gallery, Typography } from '@/constants/theme';
import { visitDate } from '@/lib/social/presentation';
import type { PublicProfile, SharedArtwork, SharedVisit } from '@/lib/social/types';
import { ProfileAvatar } from './profile-avatar';
import { socialStyles } from './social-styles';

export function ProfileIdentity({ profile, interactive = true, showChevron = false, friend = false }: { profile: PublicProfile; interactive?: boolean; showChevron?: boolean; friend?: boolean }) {
  const router = useRouter();
  const content = <>
    <ProfileAvatar name={profile.name} photoUrl={profile.photoUrl} size={showChevron ? 64 : 44} />
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={[styles.name, showChevron && { fontSize: 24, lineHeight: 28 }]}>{profile.name}</Text>
      <Text style={socialStyles.caption}>@{profile.username}{!showChevron ? ` · ${profile.publishedWallCount} artworks` : ''}</Text>
    </View>
    {friend && <Text style={{ color: Gallery.accent, fontSize: 13 }}>✓ Friends</Text>}
    {showChevron && <Text style={{ color: Gallery.muted }} accessible={false}>›</Text>}
  </>;
  return interactive ? <Pressable accessibilityRole="button" accessibilityLabel={`View ${profile.name}’s profile`}
    onPress={() => router.push({ pathname: '/profile/[profileId]', params: { profileId: profile.profileId } })}
    style={styles.identity}>{content}</Pressable> : <View style={styles.identity}>{content}</View>;
}

const GAP = 8, MIN_HEIGHT = 100;
const aspect = ({ artwork }: SharedArtwork) => artwork.media.width > 0 && artwork.media.height > 0 ? artwork.media.width / artwork.media.height : 1;

/** As many of the first three artworks as fit one equal-height row at a readable size, each as wide as its proportions need. */
export function VisitArtworks({ artworks, token, compact = false }: { artworks: SharedArtwork[]; token?: string | null; compact?: boolean }) {
  const [width, setWidth] = useState(0);
  const candidates = artworks.slice(0, 3);
  const fit = (count: number) => (width - GAP * (count - 1)) / candidates.slice(0, count).reduce((sum, item) => sum + aspect(item), 0);
  const count = [3, 2].find((n) => n <= candidates.length && fit(n) >= MIN_HEIGHT) ?? Math.min(1, candidates.length);
  const preview = candidates.slice(0, count);
  const ratios = preview.map(aspect);
  const height = Math.min(compact ? 200 : 300, fit(count));
  return <View testID="visit-artworks" style={[styles.strip, { gap: GAP }]} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
    {width > 0 && preview.map(({ itemId, artwork }, index) => <View key={itemId} style={{ width: height * ratios[index], height, overflow: 'hidden' }}>
      <DisplayMedia media={artwork.media} label={artwork.title} token={token} width={height * ratios[index]} />
    </View>)}
    {!preview.length && <Text style={socialStyles.caption}>A moment from the museum.</Text>}
  </View>;
}

export function VisitCard({ visit, token }: { visit: SharedVisit; token?: string | null }) {
  const router = useRouter();
  const { fontScale } = useWindowDimensions();
  const openVisit = () => router.push({ pathname: '/visit/[postId]', params: { postId: visit.postId } });
  const openProfile = () => router.push({ pathname: '/profile/[profileId]', params: { profileId: visit.author.profileId } });
  const count = visit.artworkCount ?? visit.artworks.page.length;
  const countLabel = `${count}${visit.artworkCount === undefined && !visit.artworks.isDone ? '+' : ''} ${count === 1 && visit.artworkCount !== undefined ? 'artwork' : 'artworks'}`;
  const openMenu = () => ActionSheetIOS.showActionSheetWithOptions(
    { options: ['View visit', `View ${visit.author.name}’s profile`, 'Cancel'], cancelButtonIndex: 2 },
    (index) => { if (index === 0) openVisit(); else if (index === 1) openProfile(); });
  return <View style={styles.card}>
    <View style={[styles.feedHeading, fontScale > 1.4 && { flexDirection: 'column' }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={`View ${visit.author.name}’s profile`} onPress={openProfile}
        style={[styles.feedIdentity, fontScale > 1.4 && { flex: 0, width: '100%' }]}>
        <ProfileAvatar name={visit.author.name} photoUrl={visit.author.photoUrl} size={52} />
        <View style={{ flex: 1, gap: 1 }}>
          <Text style={styles.feedName}>{visit.author.name}</Text>
          <Text style={styles.feedMuseum}>{visit.venue.name}</Text>
          <Text accessibilityLabel={visitDate(visit.visitedOn)} style={styles.feedDate}>{visitDate(visit.visitedOn, undefined, 'short')}{visit.venue.city ? ` · ${visit.venue.city}` : ''}</Text>
        </View>
      </Pressable>
      <GalleryIconButton icon="ellipsis" label="More options" onPress={openMenu} />
    </View>
    {!!visit.artworks.page.length && <Pressable accessibilityRole="button" accessibilityLabel={`View ${visit.author.name}’s visit to ${visit.venue.name}`} onPress={openVisit}>
      <VisitArtworks artworks={visit.artworks.page} token={token} compact />
    </Pressable>}
    {!!visit.reflection && <Text selectable style={styles.reflection}>{visit.reflection}</Text>}
    <View style={styles.actions}>
      <Text style={styles.feedMeta}>{countLabel}</Text>
      <GalleryButton label="View visit" icon="arrow.right" iconPosition="trailing" onPress={openVisit} />
    </View>
  </View>;
}

const styles = StyleSheet.create({
  card: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 10, borderBottomWidth: 0.5, borderBottomColor: Gallery.separator },
  feedHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 14 },
  feedIdentity: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  feedName: { ...Typography.section, color: Gallery.ink },
  feedMuseum: { fontSize: 17, lineHeight: 23, color: Gallery.ink },
  feedDate: { fontSize: 15, lineHeight: 21, color: Gallery.muted },
  feedMeta: { fontSize: 15, lineHeight: 22, color: Gallery.muted },
  reflection: { fontSize: 17, lineHeight: 25, letterSpacing: -0.15, color: Gallery.ink, marginTop: 14, marginBottom: 2 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  name: { ...Typography.section, color: Gallery.ink },
  strip: { flexDirection: 'row', alignItems: 'center', backgroundColor: Gallery.paper },
  actions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 4 },
});
