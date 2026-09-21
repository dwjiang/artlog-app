import { SearchEmptyState } from '../empty-state';
import { useRouter } from 'expo-router';
import { useEffect, useState, type ReactElement } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../../../convex/_generated/api';
import { Fonts, Gallery, Typography } from '@/constants/theme';
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
import { ThemedText as Text } from '@/components/themed-text';
import { LoadingRing } from '@/components/loading-ring';

type Media = SharedArtwork['artwork']['media'];
const artworksPage = (visit: SharedVisit) => visit.artworks;
const artworkId = (item: SharedArtwork) => item.itemId;

export function VisitScreen({ postId }: { postId: string }) {
  const session = useSocialSession();
  return <VisitGallery key={`${session.key}:${postId}`} postId={postId} session={session} />;
}

function VisitGallery({ postId, session }: { postId: string; session: ReturnType<typeof useSocialSession> }) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const { fontScale } = useWindowDimensions();
  const columns = fontScale > 1.4 ? 1 : 2;
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
  return <FlatList key={columns} style={socialStyles.root} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic"
    data={items} keyExtractor={artworkId} numColumns={columns} columnWrapperStyle={columns === 2 ? styles.row : undefined}
    keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets
    refreshControl={ready ? <RefreshControl refreshing={visit.refreshing} tintColor="transparent" onRefresh={visit.refresh} /> : undefined}
    ListHeaderComponent={ready && !unavailable && visit.first && author ? <>
      {visit.refreshing && <LoadingRing accessibilityLabel="Refreshing visit" style={{ paddingVertical: 12 }} />}
      <SharedVisitHeading venue={visit.first.venue} visitedOn={visit.first.visitedOn}
        owner={{ name: author.name, username: author.username, photoUrl: author.photoUrl, onPress: () => router.push({ pathname: '/profile/[profileId]', params: { profileId: author.profileId } }) }} />
      {!!visit.first.reflection && <Text selectable style={styles.reflection}>{visit.first.reflection}</Text>}
      <SharedCountHeading label={`${countLabel} ${countLabel === '1' ? 'artwork' : 'artworks'} shared`} />
      {showSearch && <VisitGallerySearch value={search} onChangeText={setSearch} />}
    </> : null}
    renderItem={({ item }) => <SharedArtworkTile title={item.artwork.title} artist={item.artwork.artist} photos={item.photos ?? []} token={session.token}
      onPress={() => router.push({ pathname: '/artwork', params: { kind: 'visit', postId, itemId: item.itemId } })} />}
    ListEmptyComponent={!ready ? <SocialGate session={session} /> : unavailable
      ? <SocialState action="Back to Home" onAction={() => { router.dismissAll(); router.navigate('/'); }} title="Visit unavailable." detail="This visit is no longer shared with you." /> : visit.done && !visit.loading && !visit.error
        ? <SharedEmpty query={query} onClear={() => setSearch('')} /> : null}
    ListFooterComponent={ready && !unavailable && !(visit.refreshing && items.length > 0 && !visit.error) ? <PageFooter {...visit} count={items.length} noun="artworks" skeleton="gallery" /> : null}
    onEndReached={ready ? visit.loadMore : undefined} onEndReachedThreshold={0.4} />;
}

export function SharedVisitHeading({ venue, visitedOn, owner }: {
  venue: { name: string; city?: string }; visitedOn: string; owner: { name: string; username?: string; photoUrl?: string; onPress?: () => void };
}) {
  const identity = <>
    <ProfileAvatar name={owner.name} photoUrl={owner.photoUrl} size={40} />
    <View style={{ flex: 1 }}><Text style={styles.ownerText}>{owner.name}</Text>{owner.username && <Text style={styles.meta}>@{owner.username}</Text>}</View>
    {owner.onPress && <VisitSymbol name="chevron.right" size={12} />}
  </>;
  return <View style={styles.heading}>
    <View style={styles.stampRow}>
      {owner.onPress ? <Pressable accessibilityRole="button" accessibilityLabel={`View ${owner.name}’s profile`} style={styles.owner} onPress={owner.onPress}>{identity}</Pressable>
        : <View style={styles.owner}>{identity}</View>}
      <View style={styles.status}><VisitSymbol name="globe" size={11} color={Gallery.ink} />
        <Text style={styles.statusText}>Public</Text></View>
    </View>
    <Text selectable accessibilityRole="header" style={styles.museum}>{venue.name}</Text>
    <Text selectable style={styles.meta}>{visitDate(visitedOn)}{venue.city ? ` · ${venue.city}` : ''}</Text>
  </View>;
}

function SharedCountHeading({ label }: { label: string }) {
  return <View style={styles.galleryHeader}><Text accessibilityRole="header" style={styles.sectionTitle}>{label}</Text></View>;
}

function SharedEmpty({ query, onClear }: { query: string; onClear: () => void }) {
  return query ? <SearchEmptyState title="No artworks found." detail="Try an artist or artwork title." onClear={onClear} />
    : <View style={styles.empty}><Text style={styles.meta}>This visit was shared without artworks.</Text></View>;
}

/** One artwork in a shared visit: the first selected photo, a photo-count badge, title, and artist. */
export function SharedArtworkTile({ title, artist, photos, token, onPress }: {
  title: string; artist: string | null; photos: Media[]; token?: string | null; onPress?: () => void;
}) {
  const media = photos[0];
  const { fontScale } = useWindowDimensions();
  const cardStyle = [styles.card, fontScale > 1.4 && { width: '100%' as const, marginBottom: 20 }];
  const tile = <VisitGalleryArtwork stageAspect={1.04} title={title} artist={artist} photoCount={photos.length} aspectRatio={media ? media.width / media.height : 1}>
    {(width) => media ? <DisplayMedia media={media} label={title} token={token} width={width} />
      : <View style={{ width, height: width, alignItems: 'center', justifyContent: 'center', backgroundColor: Gallery.fill }}>
        <Text style={styles.photoPlaceholder}>No photo shared</Text></View>}
  </VisitGalleryArtwork>;
  return onPress ? <Pressable accessibilityRole="button" accessibilityLabel={`View ${title}`}
    accessibilityHint={`${artist || 'Artist unknown'}. ${photos.length} shared photos.`} style={cardStyle} onPress={onPress}>{tile}</Pressable>
    : <View accessible accessibilityLabel={`${title}, ${artist || 'Artist unknown'}, ${photos.length} shared photos`} style={cardStyle}>{tile}</View>;
}

export type ProjectedArtwork = { key: string; title: string; artist: string | null; photos: Media[] };

/** A complete shared visit the way its audience sees it, for previews and the owner's shared version. */
export function SharedVisitProjection({ postId, author, venue, visitedOn, reflection, artworks, token, footer, note }: {
  postId: string; author: Pick<PublicProfile, 'profileId' | 'name' | 'photoUrl' | 'username'>; venue: { name: string; city?: string }; visitedOn: string;
  reflection: string; artworks: ProjectedArtwork[]; token?: string | null; footer?: ReactElement; note?: string;
}) {
  const [search, setSearch] = useState('');
  const { fontScale } = useWindowDimensions();
  const { bottom } = useSafeAreaInsets();
  const columns = fontScale > 1.4 ? 1 : 2;
  const router = useRouter();
  const query = artworks.length >= 5 ? search.trim() : '';
  const items = artworks.filter((artwork) => matchesVisitSearch(artwork, query));
  return <View style={socialStyles.root}><FlatList key={columns} style={socialStyles.root} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic"
    data={items} keyExtractor={(artwork) => artwork.key} numColumns={columns} columnWrapperStyle={columns > 1 ? styles.row : undefined}
    keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive"
    ListHeaderComponent={<>
      <SharedVisitHeading venue={venue} visitedOn={visitedOn} owner={{ ...author, onPress: () => router.push({ pathname: '/profile/[profileId]', params: { profileId: author.profileId } }) }} />
      {!!reflection && <Text selectable style={styles.reflection}>{reflection}</Text>}
      <SharedCountHeading label={`${artworks.length} ${artworks.length === 1 ? 'artwork' : 'artworks'} shared`} />
      {artworks.length >= 5 && <VisitGallerySearch value={search} onChangeText={setSearch} />}
    </>}
    renderItem={({ item }) => <SharedArtworkTile title={item.title} artist={item.artist} photos={item.photos} token={token} onPress={() => router.push({ pathname: '/artwork', params: { kind: 'visit', postId, itemId: item.key } })} />}
    ListEmptyComponent={<SharedEmpty query={query} onClear={() => setSearch('')} />}
    ListFooterComponent={<>{note && <Text style={[styles.meta, { paddingTop: 12 }]}>{note}</Text>}</>} />
    {footer && <View style={[styles.previewFooter, { paddingBottom: Math.max(20, bottom) }]}>{footer}</View>}
  </View>;
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 7, paddingBottom: 40 },
  row: { gap: 13, marginBottom: 20 },
  card: { width: '48%', flexShrink: 1 },
  heading: { paddingBottom: 12 },
  stampRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 14 },
  status: { flexDirection: 'row', maxWidth: '100%', alignItems: 'center', gap: 5, borderWidth: 0.5, borderColor: Gallery.separator, paddingVertical: 7, paddingHorizontal: 10, borderRadius: 4 },
  statusText: { flexShrink: 1, fontSize: 13, lineHeight: 18, fontWeight: '500', color: Gallery.ink },
  owner: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 40 },
  ownerText: { flexShrink: 1, ...Typography.secondary, fontWeight: '600', color: Gallery.ink },
  museum: { ...Typography.pageTitle, color: Gallery.ink, marginBottom: 8 },
  meta: { fontSize: 13, lineHeight: 20, color: Gallery.muted },
  reflection: { fontFamily: Fonts.serif, fontSize: 26, lineHeight: 34, color: Gallery.ink, marginBottom: 20 },
  galleryHeader: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: Gallery.separator, marginTop: 2, paddingTop: 15, paddingBottom: 12 },
  sectionTitle: { ...Typography.section, color: Gallery.ink, alignSelf: 'flex-start', backgroundColor: Gallery.highlight, paddingHorizontal: 5 },
  previewFooter: { paddingHorizontal: 20, borderTopWidth: 0.5, borderColor: Gallery.separator, backgroundColor: Gallery.paper },
  empty: { gap: 7, paddingVertical: 24 },
  photoPlaceholder: { color: Gallery.muted, fontSize: 13, lineHeight: 18, textAlign: 'center', padding: 5 },
});
