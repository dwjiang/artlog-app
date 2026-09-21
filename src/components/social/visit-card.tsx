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
      <Text style={socialStyles.caption}>@{profile.username}</Text>
    </View>
    {friend && <Text style={{ color: Gallery.accent, fontSize: 13 }}>✓ Friends</Text>}
    {showChevron && <Text style={{ color: Gallery.muted }} accessible={false}>›</Text>}
  </>;
  return interactive ? <Pressable accessibilityRole="button" accessibilityLabel={`View ${profile.name}’s profile`}
    onPress={() => router.push({ pathname: '/profile/[profileId]', params: { profileId: profile.profileId } })}
    style={styles.identity}>{content}</Pressable> : <View style={styles.identity}>{content}</View>;
}

const GAP = 8, MIN_HEIGHT = 100;
const aspect = ({ media }: { media: SharedArtwork['artwork']['media'] }) => media.width > 0 && media.height > 0 ? media.width / media.height : 1;

type Candidate = { key: string; media: SharedArtwork['artwork']['media']; title: string };

/** One slot per leading artwork, so every ranked highlight appears; spare slots take their extra selected photos. */
function previewCandidates(artworks: (Pick<SharedArtwork, 'artwork' | 'photos'> & { itemId?: string })[]): Candidate[] {
  const shown = artworks.slice(0, 3);
  const candidates: Candidate[] = [];
  shown.forEach(({ itemId, artwork, photos }, index) => {
    const reserved = shown.length - index - 1;
    const limit = Math.max(1, 3 - candidates.length - reserved);
    (photos?.length ? photos : [artwork.media]).slice(0, limit).forEach((media, photo) =>
      candidates.push({ key: `${itemId ?? index}:${photo}`, media, title: photo ? `${artwork.title}, photo ${photo + 1}` : artwork.title }));
  });
  return candidates;
}

/** Fit selected photos into an equal-height row while preserving each photo's proportions. */
export function VisitArtworks({ artworks, token, compact = false }: { artworks: (Pick<SharedArtwork, 'artwork' | 'photos'> & { itemId?: string })[]; token?: string | null; compact?: boolean }) {
  const [width, setWidth] = useState(0);
  const candidates = previewCandidates(artworks);
  const fit = (count: number) => (width - GAP * (count - 1)) / candidates.slice(0, count).reduce((sum, item) => sum + aspect(item), 0);
  const count = [3, 2].find((n) => n <= candidates.length && fit(n) >= MIN_HEIGHT) ?? Math.min(1, candidates.length);
  const preview = candidates.slice(0, count);
  const ratios = preview.map(aspect);
  const height = Math.min(compact ? 236 : 300, Math.max(0, fit(count)));
  return <View testID="visit-artworks" style={[styles.strip, { gap: GAP }]} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
    {width > 0 && preview.map(({ key, media, title }, index) => <View key={key} style={{ width: height * ratios[index], height, overflow: 'hidden' }}>
      <DisplayMedia media={media} label={title} token={token} width={height * ratios[index]} height={height} />
    </View>)}
    {!preview.length && <Text style={socialStyles.caption}>No artwork previews.</Text>}
  </View>;
}

export function VisitCard({ visit, token, showAuthor = true }: { visit: SharedVisit; token?: string | null; showAuthor?: boolean }) {
  const router = useRouter();
  const openVisit = () => router.push({ pathname: '/visit/[postId]', params: { postId: visit.postId } });
  const openProfile = () => router.push({ pathname: '/profile/[profileId]', params: { profileId: visit.author.profileId } });
  const openMenu = () => ActionSheetIOS.showActionSheetWithOptions(
    { options: ['View visit', `View ${visit.author.name}’s profile`, 'Cancel'], cancelButtonIndex: 2 },
    (index) => { if (index === 0) openVisit(); else if (index === 1) openProfile(); });
  return <VisitFeedCard author={visit.author} venue={visit.venue} visitedOn={visit.visitedOn} notes={visit.reflection}
    artworks={visit.artworks.page} artworkCount={visit.artworkCount} hasMore={!visit.artworks.isDone} token={token} showAuthor={showAuthor}
    onOpenVisit={openVisit} onOpenProfile={openProfile} onOpenMenu={openMenu} />;
}

export function VisitFeedCard({ author, venue, visitedOn, notes, artworks, artworkCount, hasMore = false, token, showAuthor = true, inset = true, onOpenVisit, onOpenProfile, onOpenMenu }: {
  author: Pick<PublicProfile, 'name' | 'photoUrl'>; venue: { name: string; city?: string }; visitedOn: string; notes: string;
  artworks: (Pick<SharedArtwork, 'artwork' | 'photos'> & { itemId?: string })[]; artworkCount?: number; hasMore?: boolean; token?: string | null;
  showAuthor?: boolean; inset?: boolean; onOpenVisit?: () => void; onOpenProfile?: () => void; onOpenMenu?: () => void;
}) {
  const { fontScale } = useWindowDimensions();
  const count = artworkCount ?? artworks.length;
  const photoCount = artworks.reduce((sum, item) => sum + (item.photos?.length ?? 0), 0);
  const countLabel = `${count}${artworkCount === undefined && hasMore ? '+' : ''} ${count === 1 && (artworkCount !== undefined || !hasMore) ? 'artwork' : 'artworks'}`;
  const date = <Text accessibilityLabel={visitDate(visitedOn)} style={styles.feedDate}>{visitDate(visitedOn, undefined, 'short')}{venue.city ? ` · ${venue.city}` : ''}</Text>;
  const identity = <><ProfileAvatar name={author.name} photoUrl={author.photoUrl} size={40} /><View style={{ flex: 1, gap: 1 }}><Text style={styles.feedName}>{author.name}</Text>{date}</View></>;
  const art = <VisitArtworks artworks={artworks} token={token} compact />;
  return <View style={[styles.card, !inset && { marginHorizontal: 0 }]}>
    {showAuthor ? <View style={[styles.feedHeading, fontScale > 1.4 && { flexDirection: 'column' }]}>
      {onOpenProfile ? <Pressable accessibilityRole="button" accessibilityLabel={`View ${author.name}’s profile`} onPress={onOpenProfile} style={styles.feedIdentity}>{identity}</Pressable> : <View style={styles.feedIdentity}>{identity}</View>}
      {onOpenMenu ? <GalleryIconButton icon="ellipsis" label="More options" onPress={onOpenMenu} /> : <Text style={styles.feedMeta} accessible={false}>···</Text>}
    </View> : <View style={styles.feedHeading}>{date}</View>}
    {!!artworks.length && (onOpenVisit ? <Pressable accessibilityRole="button" accessibilityLabel={`View ${author.name}’s visit to ${venue.name}`} onPress={onOpenVisit}>{art}</Pressable> : art)}
    <Text selectable style={styles.feedMuseum}>{venue.name}</Text>
    {!!notes && <Text selectable style={styles.notes}>{notes}</Text>}
    <View style={styles.actions}>
      <Text style={styles.feedMeta}>{countLabel}{photoCount > 0 ? ` · ${photoCount}${hasMore ? '+' : ''} ${photoCount === 1 && !hasMore ? 'photo' : 'photos'}` : ''}</Text>
      {onOpenVisit ? <GalleryButton label="View visit" icon="arrow.right" iconPosition="trailing" onPress={onOpenVisit} /> : <Text style={{ ...Typography.metadata, color: Gallery.accent }}>View visit →</Text>}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 20, paddingTop: 22, paddingBottom: 16, borderBottomWidth: 0.5, borderBottomColor: Gallery.softBorder },
  feedHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 14 },
  feedIdentity: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  feedName: { ...Typography.secondary, fontWeight: '600', color: Gallery.ink },
  feedMuseum: { ...Typography.display, fontSize: 28, lineHeight: 34, color: Gallery.ink, marginTop: 14, marginBottom: 6 },
  feedDate: { ...Typography.metadata, color: Gallery.muted },
  feedMeta: { ...Typography.metadata, color: Gallery.muted },
  notes: { ...Typography.secondary, color: Gallery.ink, marginBottom: 2 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  name: { ...Typography.secondary, fontWeight: '600', color: Gallery.ink },
  strip: { flexDirection: 'row', alignItems: 'center', backgroundColor: Gallery.paper },
  actions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 4 },
});
