import { socialStyles } from './social-styles';
import { Stack, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { SocialText as Text } from './social-text';
import { api } from '../../../convex/_generated/api';
import { Gallery } from '@/constants/theme';
import type { SharedVisit } from '@/lib/social/types';
import { useCursorPages } from '@/lib/social/use-social-query';
import { useSocialSession } from '@/lib/social/use-social-session';
import { PageFooter, SocialGate, SocialState } from './social-state';
import { VisitCard } from './visit-card';

const feedPage = (result: { page: SharedVisit[]; cursor: string | null; isDone: boolean }) => result;
const visitId = (visit: SharedVisit) => visit.postId;

export function HomeScreen() {
  const session = useSocialSession();
  const feed = useCursorPages(api.sharedVisits.listFeed, session.status === 'ready' ? {} : 'skip', session.key, feedPage, visitId);
  const router = useRouter();
  const ready = session.status === 'ready';
  return <>
    <FlatList style={socialStyles.root} contentContainerStyle={socialStyles.content} contentInsetAdjustmentBehavior="automatic"
      data={ready ? feed.items : []} keyExtractor={visitId} initialNumToRender={4} maxToRenderPerBatch={4}
      renderItem={({ item }) => <VisitCard visit={item} token={session.token} />}
      refreshControl={ready ? <RefreshControl refreshing={feed.refreshing}
        tintColor={Gallery.accent} onRefresh={feed.refresh} /> : undefined}
      ListHeaderComponent={<View style={styles.heading}>
        <Text accessibilityRole="header" style={styles.eyebrow}>Recent visits</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Image source="sf:arrow.down" tintColor={Gallery.muted} style={{ width: 11, height: 11 }} />
          <Text style={styles.order}>Newest visit first</Text>
        </View>
      </View>}
      ListEmptyComponent={!ready ? <SocialGate session={session} /> : feed.done && !feed.error
        ? <SocialState title="A new view is on its way." detail="When your friends share a museum visit, it will appear here. Find someone whose eye you love."
          action="Find people" onAction={() => router.push('/people')} /> : null}
      ListFooterComponent={ready ? <PageFooter {...feed} count={feed.items.length} /> : null}
      onEndReached={ready ? feed.loadMore : undefined} onEndReachedThreshold={0.4} />
    <Stack.Toolbar placement="left">
      <Stack.Toolbar.Button icon="person.crop.circle" accessibilityLabel="Your profile and settings" tintColor={Gallery.accent} hidesSharedBackground
        onPress={() => router.push('/settings')}>Your profile and settings</Stack.Toolbar.Button>
    </Stack.Toolbar>
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Button icon="trophy" accessibilityLabel="Leaderboards" tintColor={Gallery.ink} hidesSharedBackground onPress={() => router.push('/leaderboards')}>Leaderboards</Stack.Toolbar.Button>
      <Stack.Toolbar.Button icon="magnifyingglass" accessibilityLabel="Find people" tintColor={Gallery.ink} hidesSharedBackground
        onPress={() => router.push('/people')}>Find people</Stack.Toolbar.Button>
    </Stack.Toolbar>
  </>;
}

const styles = StyleSheet.create({
  heading: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center',
    gap: 8, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 14, borderBottomWidth: 0.5, borderBottomColor: Gallery.separator },
  eyebrow: { fontSize: 10, lineHeight: 16, fontWeight: '500', letterSpacing: 1.1, textTransform: 'uppercase', color: Gallery.muted },
  order: { fontSize: 10, lineHeight: 16, color: Gallery.muted },
});
