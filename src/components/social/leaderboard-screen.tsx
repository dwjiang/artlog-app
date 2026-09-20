import { AppleSignInAction } from '../account/apple-sign-in-action';
import { useAccount } from '@/lib/account/use-account';
import { EmptyState } from '../empty-state';
import { EmptyPodium } from '../empty-state-art';
import { router, Stack } from 'expo-router';
import { useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { ThemedText as Text } from '@/components/themed-text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { FunctionReturnType } from 'convex/server';
import { api } from '../../../convex/_generated/api';
import { Gallery, Typography } from '@/constants/theme';
import { signInRoute } from '@/lib/account/sign-in-context';
import { useLeaderboardChoice, type LeaderboardChoice } from '@/lib/social/use-leaderboard-choice';
import { useSocialQuery } from '@/lib/social/use-social-query';
import { useSocialSession } from '@/lib/social/use-social-session';
import { GalleryButton } from '../collection/gallery-button';
import { NativeSegmentedPicker } from '../collection/native-segmented-picker';
import { ChoiceMenu } from '../choice-menu';
import { LeaderboardParticipation, PARTICIPATION_LABELS } from './leaderboard-participation';
import { ProfileAvatar } from './profile-avatar';
import { SocialGate, SocialState } from './social-state';
import { ListSkeleton } from '@/components/loading-skeleton';

type BoardRow = FunctionReturnType<typeof api.leaderboards.list>['rows'][number];
const viewabilityConfig = { itemVisiblePercentThreshold: 100 };

export function LeaderboardScreen() {
  const session = useSocialSession();
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale > 1.4;
  const { choice, changeChoice, error: preferenceError } = useLeaderboardChoice();
  const { audience, metric, period } = choice;
  const ready = session.status === 'ready';
  const guest = session.status === 'signed-out' || session.status === 'profile-required';
  const canBrowse = ready || (audience === 'global' && guest);
  const board = useSocialQuery(api.leaderboards.list, canBrowse ? choice : 'skip', session.key);
  const [participationOpen, setParticipationOpen] = useState(false);
  const [ownVisible, setOwnVisible] = useState(false);
  const list = useRef<FlatList<BoardRow>>(null);
  const { bottom } = useSafeAreaInsets();
  function manageParticipation() {
    if (guest) {
      setParticipationOpen(false);
      router.push(session.status === 'signed-out' ? signInRoute('leaderboards') : '/create-profile');
    } else setParticipationOpen(true);
  }
  const rows = board.data?.rows ?? [];
  const mine = rows.find((row) => row.profile.profileId === session.profileId);
  const visibility = board.data?.visibility ?? 'off';
  const unit = metric === 'visits' ? 'visit' : 'artwork';
  const filter = (update: Partial<LeaderboardChoice>) => {
    changeChoice(update); setOwnVisible(false); list.current?.scrollToOffset({ offset: 0, animated: false });
  };
  const date = new Date();
  const periodLabel = period === 'month'
    ? date.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })
    : `Through ${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}`;
  return <View style={styles.root}>
    <Stack.Screen options={{ title: '', headerLargeTitle: false }} />
    <FlatList ref={list} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingBottom: 24 }}
      ListHeaderComponent={<View style={styles.filters}>
        <Text variant="pageTitle" accessibilityRole="header" style={{ marginBottom: 12 }}>Leaderboards</Text>
        <NativeSegmentedPicker label="Leaderboard audience" value={audience} onChange={(value) => filter({ audience: value })}
          options={[{ value: 'friends', label: 'Friends' }, { value: 'global', label: 'Global' }]} />
        <View style={[styles.filterRow, largeText && { flexDirection: 'column' }]}>
          <ChoiceMenu label="Ranking category" value={metric} grow={1.55} onChange={(value) => filter({ metric: value })}
            options={[{ value: 'visits', label: 'Museum visits' }, { value: 'artworks', label: 'Artworks' }]} />
          <ChoiceMenu label="Time period" value={period} onChange={(value) => filter({ period: value })}
            options={[{ value: 'month', label: 'This month' }, { value: 'all', label: 'All time' }]} />
        </View>
        <View style={styles.subline}><Text style={styles.caption}>{periodLabel}</Text></View>
        {rows.length > 0 && <View style={styles.tableHeading} accessibilityElementsHidden>
          <Text style={[styles.columnLabel, { width: 25 }]}>#</Text>
          <Text style={[styles.columnLabel, { flex: 1 }]}>{audience === 'friends' ? 'FRIENDS' : 'PEOPLE'}</Text>
          <Text style={styles.columnLabel}>{metric === 'visits' ? 'LOGGED VISITS' : 'ARTWORKS'}</Text>
        </View>}
    </View>}
      data={rows} keyExtractor={(row) => row.profile.profileId}
      viewabilityConfig={viewabilityConfig}
      onViewableItemsChanged={({ viewableItems }) => setOwnVisible(viewableItems.some(({ item }) => item.profile.profileId === session.profileId))}
      onScrollToIndexFailed={({ index, averageItemLength }) => list.current?.scrollToOffset({ offset: index * averageItemLength, animated: true })}
      renderItem={({ item, index }) => {
        const own = item.profile.profileId === session.profileId;
        const tied = rows[index - 1]?.rank === item.rank || rows[index + 1]?.rank === item.rank;
        return <Pressable accessibilityRole="button"
          accessibilityLabel={`${tied ? 'Tied rank' : 'Rank'} ${item.rank}, ${item.profile.name}${own ? ', you' : ''}, ${item.score} ${unit}${item.score === 1 ? '' : 's'}. Open public profile.`}
          onPress={() => router.push({ pathname: '/profile/[profileId]', params: { profileId: item.profile.profileId } })}
          style={[styles.row, own && styles.ownRow, largeText && { flexWrap: 'wrap' }]}>
          <Text style={[styles.rank, own && styles.ownRank, { minWidth: 25 * fontScale }]}>{item.rank}</Text>
          <ProfileAvatar name={item.profile.name} photoUrl={item.profile.photoUrl} size={48} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.name}>{item.profile.name}{own && <Text style={styles.caption}>  You</Text>}</Text>
            <Text style={styles.caption}>@{item.profile.username}</Text>
          </View>
          <Text style={styles.score}>{item.score}</Text>
        </Pressable>;
      }}
      ListEmptyComponent={!canBrowse ? guest ? <EmptyState title="A little friendly inspiration." detail="Connect with friends to see what they’ve been discovering." visual={<EmptyPodium />}>
        {session.status === 'signed-out' ? <LeaderboardSignIn /> : <GalleryButton label="Create your profile" variant="filled" fullWidth onPress={() => router.push('/create-profile')} />}
        <GalleryButton label="Explore Global" fullWidth onPress={() => filter({ audience: 'global' })} />
      </EmptyState> : <SocialGate session={session} />
        : board.loading && !board.error ? <ListSkeleton label="Opening leaderboard…" avatar rows={6} />
          : board.error ? <SocialState title="Couldn’t load the leaderboard." action="Try again" onAction={board.refresh} />
            : board.data ? <EmptyState title={audience === 'friends' ? 'A little friendly inspiration.' : period === 'month' ? 'The month is yours to start.' : 'A little inspiration starts here.'}
              detail={audience === 'friends' ? 'No friends on this board yet. Find your people and share the inspiration.' : metric === 'visits' ? 'No visits on this board yet. Log a museum visit to get started.' : 'No artworks on this board yet. Scan an artwork to get started.'} visual={<EmptyPodium />}>
              <GalleryButton label={audience === 'friends' ? 'Find people' : metric === 'visits' ? 'Add visit' : 'Scan artwork'} variant="filled" fullWidth
                onPress={() => {
                  if (audience === 'friends') router.push('/people');
                  else if (metric === 'visits') router.push('/visit-create');
                  else { router.dismissAll(); router.navigate('/scan'); }
                }} />
              {audience === 'friends' && <GalleryButton label="Explore Global" fullWidth onPress={() => filter({ audience: 'global' })} />}
            </EmptyState> : null}
      ListFooterComponent={<View style={styles.explainer}>
        {preferenceError && <Text accessibilityRole="alert" style={styles.caption}>{preferenceError}</Text>}
        {rows.length > 0 && <Text style={styles.explanation}>{metric === 'visits' ? 'One logged visit per museum, per day.' : 'Each identified artwork counts once per person. Unidentified entries count separately. Extra photos and encounters don’t add to the total.'}</Text>}
      </View>} />
    <View style={[styles.footer, largeText && { flexDirection: 'column', alignItems: 'stretch' }, { paddingBottom: Math.max(14, bottom) }]}>
      {mine ? ownVisible ? <View style={{ flex: 1 }}><Text style={styles.footerTitle}>You’re on the board</Text><Text style={styles.caption}>{PARTICIPATION_LABELS[visibility]}</Text></View>
        : <Pressable accessibilityRole="button" accessibilityLabel={`Jump to your position, rank ${mine.rank}, ${mine.score} ${unit}${mine.score === 1 ? '' : 's'}`}
          style={{ flex: 1, flexDirection: 'row', gap: 10, alignItems: 'center', minHeight: 44 }}
          onPress={() => list.current?.scrollToIndex({ index: rows.indexOf(mine), animated: true })}>
          <Text style={styles.position}>#{mine.rank}</Text><View><Text style={styles.footerTitle}>Your position ↓</Text><Text style={styles.caption}>{mine.score} {unit}{mine.score === 1 ? '' : 's'}</Text></View>
        </Pressable>
        : <View style={{ flex: 1 }}><Text style={styles.footerTitle}>{visibility === 'global' ? 'Participating on Global' : visibility === 'friends' ? 'Friends only' : 'Not participating'}</Text>
          <Text style={styles.caption}>{visibility === 'global' ? 'Your totals can appear on Global.' : visibility === 'friends' ? 'Your totals are shared with friends.' : 'Browse without sharing your totals.'}</Text></View>}
      <GalleryButton label={visibility === 'off' ? 'Join' : 'Manage'} variant="outlined" onPress={manageParticipation} />
    </View>
    {participationOpen && <LeaderboardParticipation onDismiss={() => setParticipationOpen(false)} />}
  </View>;
}

function LeaderboardSignIn() {
  const account = useAccount();
  return <AppleSignInAction state={account} />;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Gallery.paper },
  filters: { paddingHorizontal: 20, paddingTop: 10, backgroundColor: Gallery.paper },
  filterRow: { flexDirection: 'row', gap: 9, marginTop: 13 },
  subline: { paddingVertical: 13, borderBottomWidth: 0.5, borderBottomColor: Gallery.separator },
  caption: { fontSize: 13, lineHeight: 18, color: Gallery.muted },
  tableHeading: { flexDirection: 'row', gap: 10, paddingTop: 11, paddingBottom: 9, alignItems: 'center' },
  columnLabel: { fontSize: 13, letterSpacing: 1, color: Gallery.muted },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 62, paddingVertical: 7, marginHorizontal: 18, borderBottomWidth: 0.5, borderBottomColor: Gallery.separator },
  ownRow: { backgroundColor: Gallery.highlight, borderRadius: 2, marginHorizontal: 9, paddingHorizontal: 9, marginVertical: 4, borderBottomWidth: 0 },
  rank: { minWidth: 25, fontSize: 14, color: Gallery.muted, fontVariant: ['tabular-nums'] },
  ownRank: { color: Gallery.surface, backgroundColor: Gallery.ink, textAlign: 'center', paddingVertical: 4 },
  name: { ...Typography.section, fontSize: 24, lineHeight: 28, color: Gallery.ink },
  score: { ...Typography.section, fontSize: 28, lineHeight: 34, color: Gallery.ink, fontVariant: ['tabular-nums'], letterSpacing: -0.5 },
  explainer: { paddingHorizontal: 20, paddingTop: 10, gap: 0 },
  explanation: { color: Gallery.muted, fontSize: 13, lineHeight: 18 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 12, borderTopWidth: 0.5, borderTopColor: Gallery.separator },
  footerTitle: { color: Gallery.ink, fontSize: 13, fontWeight: '500', lineHeight: 19 },
  position: { paddingHorizontal: 8, paddingVertical: 7, backgroundColor: Gallery.highlight, color: Gallery.ink, borderRadius: 8, fontSize: 13, fontVariant: ['tabular-nums'] },
});
