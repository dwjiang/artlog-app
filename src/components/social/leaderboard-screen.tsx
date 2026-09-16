import { Image } from 'expo-image';
import { router, Stack } from 'expo-router';
import { useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { api } from '../../../convex/_generated/api';
import { Gallery } from '@/constants/theme';
import { useSocialQuery } from '@/lib/social/use-social-query';
import { useSocialSession } from '@/lib/social/use-social-session';
import { GalleryButton } from '../collection/gallery-button';
import { NativeSegmentedPicker } from '../collection/native-segmented-picker';
import { ProfileIdentity } from './visit-card';
import { SocialGate, SocialState } from './social-state';

export function LeaderboardScreen() {
  const session = useSocialSession();
  const [audience, setAudience] = useState<'friends' | 'global'>('friends');
  const [metric, setMetric] = useState<'visits' | 'contributions'>('visits');
  const [period, setPeriod] = useState<'month' | 'all'>('month');
  const board = useSocialQuery(api.leaderboards.list, session.status === 'ready' ? { audience, metric, period } : 'skip', session.key);
  const scroll = useRef<ScrollView>(null), ownY = useRef(0);
  if (session.status !== 'ready') return <SocialGate session={session} />;
  const mine = board.data?.rows.find((row) => row.profile.profileId === session.profileId);
  return <View style={{ flex: 1, backgroundColor: Gallery.paper }}><Stack.Screen options={{ title: 'Leaderboards' }} />
    <ScrollView ref={scroll} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, gap: 18, paddingBottom: 35 }}>
      <View style={{ alignItems: 'center', gap: 9, paddingVertical: 14 }}><Image source="sf:trophy" tintColor="#937841" style={{ width: 34, height: 34 }} /><Text style={{ fontFamily: 'Georgia', fontSize: 29, color: Gallery.ink }}>A little more curious.</Text><Text style={{ fontSize: 12, color: Gallery.muted }}>Celebrate time with art.</Text></View>
      <NativeSegmentedPicker label="Leaderboard audience" value={audience} onChange={setAudience} options={[{ value: 'friends', label: 'Friends' }, { value: 'global', label: 'Global' }]} />
      <NativeSegmentedPicker label="Leaderboard metric" value={metric} onChange={setMetric} options={[{ value: 'visits', label: 'Museum visits' }, { value: 'contributions', label: 'Contributions' }]} />
      <NativeSegmentedPicker label="Leaderboard period" value={period} onChange={setPeriod} options={[{ value: 'month', label: 'This month' }, { value: 'all', label: 'All time' }]} />
      <Text style={{ color: Gallery.muted, fontSize: 11, lineHeight: 17 }}>{metric === 'visits' ? 'One visit per museum, per day. Backdated visits count on the day you went.' : 'Distinct artworks with accepted contributions. Pending and duplicate submissions do not count.'}</Text>
      {board.data?.rows.map((row) => <View key={row.profile.profileId} onLayout={(event) => { if (row.profile.profileId === session.profileId) ownY.current = event.nativeEvent.layout.y; }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, borderBottomWidth: 0.5, borderBottomColor: Gallery.separator, backgroundColor: row.profile.profileId === session.profileId ? Gallery.fill : undefined }}>
        <Text style={{ width: 26, fontSize: 18, fontFamily: 'Georgia', color: row.rank <= 3 ? '#937841' : Gallery.muted }}>{row.rank}</Text>
        <View style={{ flex: 1 }}><ProfileIdentity profile={row.profile} /></View><Text style={{ fontSize: 22, color: Gallery.accent, fontVariant: ['tabular-nums'] }}>{row.score}</Text>
      </View>)}
      {board.loading && <SocialState title="Opening leaderboard…" loading />}
      {board.error && <SocialState title="Couldn’t load the leaderboard." action="Try again" onAction={board.refresh} />}
      {board.data && !board.data.rows.length && <SocialState title="Room for a curious friend." detail="People who choose to participate will appear here." />}
      <Text style={{ color: Gallery.muted, fontSize: 11, lineHeight: 17 }}>Only your profile and totals appear. Your private photos, notes, and visit locations stay private.</Text>
    </ScrollView>
    <View style={{ padding: 20, paddingBottom: 30, borderTopWidth: 0.5, borderTopColor: Gallery.separator }}>
      {mine ? <GalleryButton label={`You’re #${mine.rank} · ${mine.score} ${metric} · Jump to you`} fullWidth onPress={() => scroll.current?.scrollTo({ y: ownY.current, animated: true })} />
        : <GalleryButton label="Choose leaderboard visibility" fullWidth onPress={() => router.push('/settings')} />}
    </View>
  </View>;
}
