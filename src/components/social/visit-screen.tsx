import { socialStyles } from './social-styles';
import { useRouter } from 'expo-router';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { SocialText as Text } from './social-text';
import { api } from '../../../convex/_generated/api';
import { Gallery } from '@/constants/theme';
import { convexErrorCode } from '@/lib/network-error';
import type { SharedArtwork, SharedVisit } from '@/lib/social/types';
import { useCursorPages } from '@/lib/social/use-social-query';
import { useSocialSession } from '@/lib/social/use-social-session';
import { PageFooter, SocialGate, SocialState } from './social-state';
import { VisitArtworks, VisitHeading } from './visit-card';

const artworksPage = (visit: SharedVisit) => visit.artworks;
const artworkId = (item: SharedArtwork) => item.itemId;

export function VisitScreen({ postId }: { postId: string }) {
  const session = useSocialSession();
  const router = useRouter();
  const ready = session.status === 'ready';
  const visit = useCursorPages(api.sharedVisits.get, ready && postId ? { postId } : 'skip', session.key, artworksPage, artworkId);
  const unavailable = !postId || convexErrorCode(visit.error) === 'not_found';
  return <FlatList style={socialStyles.root} contentContainerStyle={socialStyles.content} contentInsetAdjustmentBehavior="automatic"
    data={ready ? visit.items : []} keyExtractor={artworkId}
    refreshControl={ready ? <RefreshControl refreshing={visit.refreshing} tintColor={Gallery.accent} onRefresh={visit.refresh} /> : undefined}
    ListHeaderComponent={ready && visit.first ? <>
      <VisitHeading visit={visit.first} />
      {!!visit.first.reflection && <Text selectable style={[socialStyles.body, { paddingHorizontal: 24, paddingBottom: 24 }]}>{visit.first.reflection}</Text>}
      <Text accessibilityRole="header" style={[socialStyles.title, { padding: 24 }]}>Shared artworks</Text>
    </> : null}
    renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={`View ${item.artwork.title}`}
      onPress={() => router.push({ pathname: '/artwork', params: { kind: 'visit', postId, itemId: item.itemId } })}>
      <VisitArtworks artworks={[item]} token={session.token} />
      <View style={socialStyles.section}>
        <Text selectable style={socialStyles.body}>{item.artwork.title}</Text>
        <Text selectable style={socialStyles.caption}>{item.artwork.artist}</Text>
      </View>
    </Pressable>}
    ListEmptyComponent={!ready ? <SocialGate session={session} /> : unavailable
      ? <SocialState title="Visit unavailable." detail="This visit is no longer shared with you." /> : visit.done
        ? <SocialState title="A moment from the museum." detail="No artworks are shared in this visit." /> : null}
    ListFooterComponent={ready && !unavailable ? <PageFooter {...visit} count={visit.items.length} noun="artworks" /> : null}
    onEndReached={ready ? visit.loadMore : undefined} onEndReachedThreshold={0.4} />;
}
