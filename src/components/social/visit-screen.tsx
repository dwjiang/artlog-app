import { useRouter } from 'expo-router';
import { useEffect, useState, type ReactElement } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { api } from '../../../convex/_generated/api';
import { Gallery } from '@/constants/theme';
import { convexErrorCode } from '@/lib/network-error';
import { visitDate } from '@/lib/social/presentation';
import type { PublicProfile, SharedArtwork, SharedVisit } from '@/lib/social/types';
import { useCursorPages } from '@/lib/social/use-social-query';
import { useSocialSession } from '@/lib/social/use-social-session';
import { DisplayMedia } from '../artwork/display-media';
import { matchesVisitSearch, VisitGalleryArtwork, VisitGallerySearch } from '../visits/visit-gallery';
import { VisitSymbol } from '../visits/visit-ui';
import { ProfileAvatar } from './profile-avatar';
import { PageFooter, SocialGate, SocialState } from './social-state';
import { socialStyles } from './social-styles';
import { SocialText as Text } from './social-text';

type Media = SharedArtwork['artwork']['media'];
type VisitAudience = SharedVisit['audience'];
const artworksPage = (visit: SharedVisit) => visit.artworks;
const artworkId = (item: SharedArtwork) => item.itemId;

export function VisitScreen({ postId }: { postId: string }) {
  const session = useSocialSession();
  return <VisitGallery key={`${session.key}:${postId}`} postId={postId} session={session} />;
}

function VisitGallery({ postId, session }: { postId: string; session: ReturnType<typeof useSocialSession> }) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const ready = !session.offline && ['ready', 'signed-out', 'profile-required'].includes(session.status);
  const visit = useCursorPages(api.sharedVisits.get, ready && postId ? { postId } : 'skip', session.key, artworksPage, artworkId);
  const unavailable = !postId || convexErrorCode(visit.error) === 'not_found';
  const totalCount = visit.first?.artworkCount ?? visit.items.length;
  const showSearch = totalCount >= 5;
  const query = showSearch ? search.trim() : '';
  const { canLoadMore, loadMore } = visit;
  // A search covers the whole shared visit, including pages the viewer has not scrolled to yet.
  useEffect(() => { if (ready && query && canLoadMore) loadMore(); }, [ready, query, canLoadMore, loadMore]);
  const items = ready && !unavailable ? visit.items.filter((item) => matchesVisitSearch(item.artwork, query)) : [];
  const countLabel = `${totalCount}${visit.first?.artworkCount === undefined && !visit.done ? '+' : ''}`;
  const author = visit.first?.author;
  return <FlatList style={socialStyles.root} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic"
    data={items} keyExtractor={artworkId} numColumns={2} columnWrapperStyle={styles.row}
    keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets
    refreshControl={ready ? <RefreshControl refreshing={visit.refreshing} tintColor={Gallery.accent} onRefresh={visit.refresh} /> : undefined}
    ListHeaderComponent={ready && !unavailable && visit.first && author ? <>
      <SharedVisitHeading venue={visit.first.venue} visitedOn={visit.first.visitedOn} audience={visit.first.audience}
        owner={{ name: author.name, photoUrl: author.photoUrl, onPress: () => router.push({ pathname: '/profile/[profileId]', params: { profileId: author.profileId } }) }} />
      {!!visit.first.reflection && <Text selectable style={styles.reflection}>{visit.first.reflection}</Text>}
      <SharedCountHeading label={`${countLabel} ${countLabel === '1' ? 'artwork' : 'artworks'} shared`} />
      {showSearch && <VisitGallerySearch value={search} onChangeText={setSearch} />}
    </> : null}
    renderItem={({ item }) => <SharedArtworkTile title={item.artwork.title} artist={item.artwork.artist} photos={item.photos ?? []} token={session.token}
      onPress={() => router.push({ pathname: '/artwork', params: { kind: 'visit', postId, itemId: item.itemId } })} />}
    ListEmptyComponent={!ready ? <SocialGate session={session} /> : unavailable
      ? <SocialState title="Visit unavailable." detail="This visit is no longer shared with you." /> : visit.done
        ? <SharedEmpty query={query} /> : null}
    ListFooterComponent={ready && !unavailable ? <PageFooter {...visit} count={items.length} noun="artworks" /> : null}
    onEndReached={ready ? visit.loadMore : undefined} onEndReachedThreshold={0.4} />;
}

/** The viewer-facing header: museum stamp, audience badge, whose visit it is, place, and date. */
export function SharedVisitHeading({ venue, visitedOn, audience, owner }: {
  venue: { name: string; city?: string }; visitedOn: string; audience: VisitAudience; owner: { name: string; photoUrl?: string; onPress?: () => void };
}) {
  const identity = <>
    <ProfileAvatar name={owner.name} photoUrl={owner.photoUrl} size={25} />
    <Text style={styles.ownerText}>{owner.name}’s visit</Text>
    {owner.onPress && <VisitSymbol name="chevron.right" size={12} />}
  </>;
  return <View style={styles.heading}>
    <View style={styles.stampRow}>
      <View style={styles.stamp}><VisitSymbol name="building.columns" size={23} color="#66735C" /></View>
      <View style={styles.status}><VisitSymbol name={audience === 'public' ? 'globe' : 'person.2'} size={11} color="#627158" />
        <Text style={styles.statusText}>{audience === 'public' ? 'Shared publicly' : 'Shared with friends'}</Text></View>
    </View>
    {owner.onPress ? <Pressable accessibilityRole="button" accessibilityLabel={`View ${owner.name}’s profile`} style={styles.owner} onPress={owner.onPress}>{identity}</Pressable>
      : <View style={styles.owner}>{identity}</View>}
    <Text selectable accessibilityRole="header" style={styles.museum}>{venue.name}</Text>
    <Text selectable style={styles.meta}>{venue.city ? `${venue.city}\n` : ''}{visitDate(visitedOn)}</Text>
  </View>;
}

function SharedCountHeading({ label }: { label: string }) {
  return <View style={styles.galleryHeader}><Text accessibilityRole="header" style={styles.sectionTitle}>{label}</Text></View>;
}

function SharedEmpty({ query }: { query: string }) {
  return query ? <Text style={styles.emptySearch}>No artworks match this search.</Text>
    : <View style={styles.empty}><Text style={styles.emptyTitle}>A visit worth remembering.</Text>
      <Text style={styles.meta}>This visit was shared without artworks.</Text></View>;
}

/** One artwork in a shared visit: the first selected photo, a photo-count badge, title, and artist. */
export function SharedArtworkTile({ title, artist, photos, token, onPress }: {
  title: string; artist: string | null; photos: Media[]; token?: string | null; onPress?: () => void;
}) {
  const media = photos[0];
  const tile = <VisitGalleryArtwork title={title} artist={artist} photoCount={photos.length} aspectRatio={media ? media.width / media.height : 1}>
    {(width) => media ? <DisplayMedia media={media} label={title} token={token} width={width} />
      : <View style={{ width, height: width, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E4E7DD' }}>
        <Text style={styles.photoPlaceholder}>No photo shared</Text></View>}
  </VisitGalleryArtwork>;
  return onPress ? <Pressable accessibilityRole="button" accessibilityLabel={`View ${title}`}
    accessibilityHint={`${artist || 'Artist unknown'}. ${photos.length} shared photos.`} style={styles.card} onPress={onPress}>{tile}</Pressable>
    : <View accessible accessibilityLabel={`${title}, ${artist || 'Artist unknown'}, ${photos.length} shared photos`} style={styles.card}>{tile}</View>;
}

export type ProjectedArtwork = { key: string; title: string; artist: string | null; photos: Media[] };

/** A complete shared visit the way its audience sees it, for previews and the owner's shared version. */
export function SharedVisitProjection({ banner, author, venue, visitedOn, audience, reflection, artworks, token, footer, note }: {
  banner?: { title: string; copy: string }; author: Pick<PublicProfile, 'name' | 'photoUrl'>; venue: { name: string; city?: string }; visitedOn: string;
  audience: VisitAudience; reflection: string; artworks: ProjectedArtwork[]; token?: string | null; footer?: ReactElement; note?: string;
}) {
  const [search, setSearch] = useState('');
  const query = artworks.length >= 5 ? search.trim() : '';
  const items = artworks.filter((artwork) => matchesVisitSearch(artwork, query));
  return <FlatList style={socialStyles.root} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic"
    data={items} keyExtractor={(artwork) => artwork.key} numColumns={2} columnWrapperStyle={styles.row}
    keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive"
    ListHeaderComponent={<>
      {banner && <View style={styles.banner}><Text style={styles.bannerTitle}>{banner.title}</Text><Text style={styles.bannerCopy}>{banner.copy}</Text></View>}
      <SharedVisitHeading venue={venue} visitedOn={visitedOn} audience={audience} owner={author} />
      {!!reflection && <Text selectable style={styles.reflection}>{reflection}</Text>}
      <SharedCountHeading label={`${artworks.length} ${artworks.length === 1 ? 'artwork' : 'artworks'} shared`} />
      {artworks.length >= 5 && <VisitGallerySearch value={search} onChangeText={setSearch} />}
    </>}
    renderItem={({ item }) => <SharedArtworkTile title={item.title} artist={item.artist} photos={item.photos} token={token} />}
    ListEmptyComponent={<SharedEmpty query={query} />}
    ListFooterComponent={<>{note && <Text style={[styles.meta, { paddingTop: 12 }]}>{note}</Text>}{footer}</>} />;
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 7, paddingBottom: 40 },
  row: { gap: 13, marginBottom: 20 },
  card: { width: '48%', flexShrink: 1 },
  heading: { paddingBottom: 19 },
  stampRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 },
  stamp: { width: 43, height: 43, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, borderColor: '#747C6540',
    backgroundColor: '#E4E7DC', alignItems: 'center', justifyContent: 'center' },
  status: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#E5E7DE', paddingVertical: 5, paddingHorizontal: 8, borderRadius: 20 },
  statusText: { fontSize: 10, lineHeight: 15, fontWeight: '500', color: '#627158' },
  owner: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, marginBottom: 9 },
  ownerText: { flexShrink: 1, fontSize: 12, color: Gallery.muted },
  museum: { fontSize: 28, lineHeight: 33, fontWeight: '600', letterSpacing: -0.8, color: Gallery.ink, marginBottom: 8 },
  meta: { fontSize: 12, lineHeight: 20, color: Gallery.muted },
  reflection: { fontFamily: 'Georgia', fontSize: 19, lineHeight: 27, letterSpacing: -0.15, color: Gallery.ink, marginBottom: 20 },
  galleryHeader: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: Gallery.separator, marginTop: 2, paddingTop: 15, paddingBottom: 12 },
  sectionTitle: { fontSize: 11, lineHeight: 17, fontWeight: '600', color: Gallery.ink },
  banner: { padding: 12, paddingHorizontal: 14, marginBottom: 18, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: '#798A6040', backgroundColor: '#DEE5D5', gap: 3 },
  bannerTitle: { fontSize: 12, lineHeight: 18, fontWeight: '600', color: '#495D3C' },
  bannerCopy: { fontSize: 12, lineHeight: 18, color: '#495D3C' },
  emptySearch: { paddingVertical: 30, paddingHorizontal: 15, textAlign: 'center', fontSize: 12, lineHeight: 20, color: Gallery.muted },
  empty: { gap: 7, paddingVertical: 24 },
  emptyTitle: { fontSize: 14, fontWeight: '500', color: Gallery.ink },
  photoPlaceholder: { color: '#626F56', fontSize: 9, lineHeight: 14, textAlign: 'center', padding: 5 },
});
