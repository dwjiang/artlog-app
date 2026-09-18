import { WelcomePrompt } from '../account/welcome-prompt';
import { socialStyles } from './social-styles';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { FlatList, RefreshControl, StyleSheet, View, useWindowDimensions } from 'react-native';
import { ThemedText as Text } from '@/components/themed-text';
import { api } from '../../../convex/_generated/api';
import { Gallery } from '@/constants/theme';
import type { SharedVisit } from '@/lib/social/types';
import { useCursorPages } from '@/lib/social/use-social-query';
import { useSocialSession } from '@/lib/social/use-social-session';
import { PageFooter, SocialGate, SocialState } from './social-state';
import { VisitCard } from './visit-card';
import { GalleryIconButton } from '../collection/gallery-icon-button';

const feedPage = (result: { page: SharedVisit[]; cursor: string | null; isDone: boolean }) => result;
const visitId = (visit: SharedVisit) => visit.postId;

export function HomeScreen() {
  const { fontScale } = useWindowDimensions();
  const session = useSocialSession();
  const guest = session.status === 'signed-out';
  const ready = session.status === 'ready' || guest;
  const feed = useCursorPages(guest ? api.sharedVisits.listPublic : api.sharedVisits.listFeed, ready ? {} : 'skip', session.key, feedPage, visitId);
  const router = useRouter();
  return <>
    <WelcomePrompt />
    <FlatList style={socialStyles.root} contentContainerStyle={socialStyles.content} contentInsetAdjustmentBehavior="automatic"
      data={ready ? feed.items : []} keyExtractor={visitId} initialNumToRender={4} maxToRenderPerBatch={4}
      renderItem={({ item }) => <VisitCard visit={item} token={session.token} />}
      refreshControl={ready ? <RefreshControl refreshing={feed.refreshing}
        tintColor={Gallery.accent} onRefresh={feed.refresh} /> : undefined}
      ListHeaderComponent={<><View style={[styles.masthead, fontScale > 1.4 && styles.mastheadLarge]}>
        <Text variant={fontScale > 1.4 ? 'display' : 'wordmark'} accessibilityRole="header">Artlog</Text>
        <View style={styles.headerActions}>
          <GalleryIconButton icon="trophy" label="Leaderboards" tone="ink" onPress={() => router.push('/leaderboards')} />
          <GalleryIconButton icon="magnifyingglass" label="Find people" tone="ink" onPress={() => router.push('/people')} />
        </View>
      </View>{ready && <View style={styles.heading}>
        <Text variant="section" accessibilityRole="header" style={styles.eyebrow}>{guest ? 'Public visits' : 'Recent visits'}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Image source="sf:arrow.down" tintColor={Gallery.muted} style={{ width: 11, height: 11 }} />
          <Text style={styles.order}>Newest visit first</Text>
        </View>
      </View>}</>}
      ListEmptyComponent={!ready ? <SocialGate session={session} browsePublic /> : feed.done && !feed.error
        ? <SocialState title={guest ? "No public visits yet." : "A new view is on its way."} detail={guest ? "When someone shares a visit publicly, it will appear here. Explore public walls in the meantime." : "When your friends share a museum visit, it will appear here. Find someone whose eye you love."}
          action={guest ? "Browse public walls" : "Find people"} onAction={() => router.push('/people')} /> : null}
      ListFooterComponent={ready ? <PageFooter {...feed} count={feed.items.length} /> : null}
      onEndReached={ready ? feed.loadMore : undefined} onEndReachedThreshold={0.4} />
  </>;
}

const styles = StyleSheet.create({
  masthead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 16, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16 },
  mastheadLarge: { flexDirection: 'column', alignItems: 'flex-start' },
  headerActions: { flexDirection: 'row', gap: 8, alignSelf: 'flex-end', paddingBottom: 12 },
  heading: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center',
    gap: 8, paddingHorizontal: 20, paddingTop: 4, paddingBottom: 8 },
  eyebrow: { backgroundColor: Gallery.highlight, paddingHorizontal: 6, paddingVertical: 3, color: Gallery.ink },
  order: { fontSize: 13, lineHeight: 18, color: Gallery.muted },
});
