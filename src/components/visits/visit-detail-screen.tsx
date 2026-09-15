import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gallery } from '@/constants/theme';
import { useOwnerGeneration } from '@/lib/account/owner-store';
import { formatVisitDate } from '@/lib/journal/history';
import { useVisits } from '@/lib/journal/use-visits';
import type { VisitSummary } from '@/lib/journal/visit-summaries';
import { useVisitSharing } from '@/lib/visits/use-visit-sharing';
import { GalleryButton } from '../collection/gallery-button';
import { SavedWorkImage } from '../collection/saved-work-image';
import { WorkLink } from '../collection/work-link';
import { VisitMessage, VisitPage, VisitSymbol, visitStyles as styles } from './visit-ui';

export function VisitDetailScreen() {
  const { visitId } = useLocalSearchParams<{ visitId: string }>();
  const { owner, visits, loading, error } = useVisits();
  const visit = visits.find((row) => row.localId === visitId);
  if (!visit) return <VisitPage><VisitMessage loading={loading} action="Back to Collection" onAction={() => router.back()}>
    {loading ? 'Loading visit…' : error ? 'This visit could not load.' : 'This visit is unavailable for this account.'}
  </VisitMessage></VisitPage>;
  return <VisitDetail key={`${owner}:${visitId}`} visit={visit} />;
}
function VisitDetail({ visit }: { visit: VisitSummary }) {
  const generation = useOwnerGeneration();
  const sharing = useVisitSharing(visit.localId, visit.works.map((work) => work.localId));
  const signedIn = visit.owner.startsWith('account:');
  const { controller, token } = sharing;
  useFocusEffect(useCallback(() => { if (signedIn && token && generation) void controller.load(); }, [controller, signedIn, token, generation]));
  const status = !signedIn ? 'Private on this device' : sharing.profileRequired ? 'Private visit'
    : sharing.error ? 'Sharing status unavailable' : sharing.acknowledged?.status === 'active' ? 'Shared with friends'
      : sharing.acknowledged ? 'Private visit' : 'Checking sharing status…';
  return <>
    <Stack.Screen options={{ title: 'Visit' }} />
    <Stack.Toolbar placement="right"><Stack.Toolbar.Button icon="square.and.arrow.up" accessibilityLabel="Share visit"
      onPress={() => router.push({ pathname: '/visit-share/[visitId]', params: { visitId: visit.localId } })}>Share visit</Stack.Toolbar.Button></Stack.Toolbar>
    <VisitPage>
      <View style={detail.stampRow}>
        <View style={detail.stamp}><VisitSymbol name="building.columns" size={23} color="#66735C" /></View>
        <View style={detail.badge}><VisitSymbol name={sharing.acknowledged?.status === 'active' ? 'person.2' : 'lock'} size={11} color="#627158" />
          <Text style={detail.badgeText}>{status}</Text>
        </View>
      </View>
      <View style={{ gap: 8 }}>
        <Text selectable style={[styles.title, { letterSpacing: -0.8 }]}>{visit.venueName}</Text>
        <Text selectable style={styles.caption}>{visit.location || 'Location unavailable'}{'\n'}{formatVisitDate(visit.visitedOn)}</Text>
      </View>
      <GalleryButton label={sharing.acknowledged?.status === 'active' ? 'Manage sharing' : 'Share with friends'} variant="filled" fullWidth
        onPress={() => router.push({ pathname: '/visit-share/[visitId]', params: { visitId: visit.localId } })} />
      <View>
        <View style={styles.sectionLabel}>
          <Text accessibilityRole="header" style={detail.sectionTitle}>Your reflection</Text>
          <View style={{ flexDirection: 'row', gap: 4, alignItems: 'center' }}><VisitSymbol name="lock" size={10} /><Text style={detail.secondary}>Only you</Text></View>
        </View>
        {!!visit.reflection && <Text selectable style={[styles.body, { color: '#656A5C', marginBottom: 10 }]}>{visit.reflection}</Text>}
        <GalleryButton label={visit.reflection ? 'Edit reflection' : 'Add reflection'}
          onPress={() => router.push({ pathname: '/visit-reflection', params: { visitId: visit.localId } })} />
      </View>
      <View>
        <View style={styles.sectionLabel}>
          <Text accessibilityRole="header" style={detail.sectionTitle}>{visit.works.length} {visit.works.length === 1 ? 'artwork' : 'artworks'} saved</Text>
          <Text style={detail.secondary}>From this visit</Text>
        </View>
        {visit.works.length ? visit.works.map((work) => <WorkLink key={work.localId} work={work} style={detail.work}>
          <View style={detail.art}><SavedWorkImage contain path={work.cropPath} title={work.title} style={{ width: '100%', height: '100%' }} /></View>
          <View style={{ flex: 1, gap: 2 }}><Text style={detail.workTitle}>{work.title}</Text><Text style={detail.artist}>{work.artist}</Text></View>
          <VisitSymbol name="chevron.right" size={13} color="#8A8C7E" />
        </WorkLink>) : <Text style={[styles.caption, { paddingVertical: 22 }]}>No artworks saved on this visit. The memory still belongs here.</Text>}
      </View>
    </VisitPage>
  </>;
}

const detail = StyleSheet.create({
  stampRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 4 },
  stamp: { width: 43, height: 43, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, borderColor: '#747C6540', backgroundColor: '#E4E7DC', alignItems: 'center', justifyContent: 'center' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#E5E7DE', paddingVertical: 5, paddingHorizontal: 8, borderRadius: 20, flexShrink: 1 },
  badgeText: { fontSize: 10, lineHeight: 15, fontWeight: '500', color: '#627158', flexShrink: 1 },
  sectionTitle: { fontSize: 11, lineHeight: 17, fontWeight: '600', color: Gallery.ink },
  secondary: { fontSize: 10, lineHeight: 16, color: '#878A7B' },
  work: { flexDirection: 'row', gap: 13, alignItems: 'center', paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#26232017' },
  art: { width: 55, height: 57, padding: 5, backgroundColor: '#E7E8DF', borderRadius: 4 },
  workTitle: { fontSize: 13, lineHeight: 18, fontStyle: 'italic', color: Gallery.ink },
  artist: { fontSize: 12, lineHeight: 18, fontWeight: '500', color: Gallery.ink },
});
