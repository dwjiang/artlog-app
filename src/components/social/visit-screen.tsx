import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { api } from '../../../convex/_generated/api';
import { Gallery } from '@/constants/theme';
import { convexErrorCode } from '@/lib/network-error';
import { visitDate } from '@/lib/social/presentation';
import type { SharedArtwork, SharedVisit } from '@/lib/social/types';
import { useCursorPages } from '@/lib/social/use-social-query';
import { useSocialSession } from '@/lib/social/use-social-session';
import { DisplayMedia } from '../artwork/display-media';
import { matchesVisitSearch, VisitGalleryArtwork, VisitGallerySearch } from '../visits/visit-gallery';
import { VisitSymbol } from '../visits/visit-ui';
import { ProfileAvatar } from './profile-avatar';
import { PageFooter, SocialGate, SocialState } from './social-state';
import { socialStyles } from './social-styles';
import { SocialText as Text } from './social-text';

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
  return <FlatList style={socialStyles.root} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic"
    data={items} keyExtractor={artworkId} numColumns={2} columnWrapperStyle={styles.row}
    keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets
    refreshControl={ready ? <RefreshControl refreshing={visit.refreshing} tintColor={Gallery.accent} onRefresh={visit.refresh} /> : undefined}
    ListHeaderComponent={ready && !unavailable && visit.first ? <>
      <SharedVisitHeading visit={visit.first} />
      {!!visit.first.reflection && <Text selectable style={styles.reflection}>{visit.first.reflection}</Text>}
      <View style={styles.galleryHeader}><Text accessibilityRole="header" style={styles.sectionTitle}>
        {countLabel} {countLabel === '1' ? 'artwork' : 'artworks'} shared
      </Text></View>
      {showSearch && <VisitGallerySearch value={search} onChangeText={setSearch} />}
    </> : null}
    renderItem={({ item }) => {
      const media = item.photos?.[0];
      return <Pressable accessibilityRole="button" accessibilityLabel={`View ${item.artwork.title}`}
        accessibilityHint={`${item.artwork.artist || 'Artist unknown'}. ${item.photos?.length ?? 0} shared photos.`}
        style={styles.card} onPress={() => router.push({ pathname: '/artwork', params: { kind: 'visit', postId, itemId: item.itemId } })}>
        <VisitGalleryArtwork title={item.artwork.title} artist={item.artwork.artist} photoCount={item.photos?.length ?? 0}
          aspectRatio={media ? media.width / media.height : 1}>
          {(width) => media ? <DisplayMedia media={media} label={item.artwork.title} token={session.token} width={width} />
            : <View style={{ width, height: width, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E4E7DD' }}>
              <Text style={styles.photoPlaceholder}>No photo shared</Text></View>}
        </VisitGalleryArtwork>
      </Pressable>;
    }}
    ListEmptyComponent={!ready ? <SocialGate session={session} /> : unavailable
      ? <SocialState title="Visit unavailable." detail="This visit is no longer shared with you." /> : visit.done
        ? query ? <Text style={styles.emptySearch}>No artworks match this search.</Text>
          : <View style={styles.empty}><Text style={styles.emptyTitle}>A visit worth remembering.</Text>
            <Text style={styles.meta}>This visit was shared without artworks.</Text></View> : null}
    ListFooterComponent={ready && !unavailable ? <PageFooter {...visit} count={items.length} noun="artworks" /> : null}
    onEndReached={ready ? visit.loadMore : undefined} onEndReachedThreshold={0.4} />;
}

function SharedVisitHeading({ visit }: { visit: SharedVisit }) {
  const router = useRouter();
  return <View style={styles.heading}>
    <View style={styles.stampRow}>
      <View style={styles.stamp}><VisitSymbol name="building.columns" size={23} color="#66735C" /></View>
      <View style={styles.status}><VisitSymbol name={visit.audience === 'public' ? 'globe' : 'person.2'} size={11} color="#627158" />
        <Text style={styles.statusText}>{visit.audience === 'public' ? 'Shared publicly' : 'Shared with friends'}</Text></View>
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel={`View ${visit.author.name}’s profile`} style={styles.owner}
      onPress={() => router.push({ pathname: '/profile/[profileId]', params: { profileId: visit.author.profileId } })}>
      <ProfileAvatar name={visit.author.name} photoUrl={visit.author.photoUrl} size={25} />
      <Text style={styles.ownerText}>{visit.author.name}’s visit</Text><VisitSymbol name="chevron.right" size={12} />
    </Pressable>
    <Text selectable accessibilityRole="header" style={styles.museum}>{visit.venue.name}</Text>
    <Text selectable style={styles.meta}>{visit.venue.city ? `${visit.venue.city}\n` : ''}{visitDate(visit.visitedOn)}</Text>
  </View>;
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
  emptySearch: { paddingVertical: 30, paddingHorizontal: 15, textAlign: 'center', fontSize: 12, lineHeight: 20, color: Gallery.muted },
  empty: { gap: 7, paddingVertical: 24 },
  emptyTitle: { fontSize: 14, fontWeight: '500', color: Gallery.ink },
  photoPlaceholder: { color: '#626F56', fontSize: 9, lineHeight: 14, textAlign: 'center', padding: 5 },
});
