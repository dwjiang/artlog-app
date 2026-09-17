import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Gallery } from '@/constants/theme';
import { useOwnerGeneration } from '@/lib/account/owner-store';
import { formatVisitDate } from '@/lib/journal/history';
import { useVisits } from '@/lib/journal/use-visits';
import type { VisitSummary } from '@/lib/journal/visit-summaries';
import { useVisitSharing } from '@/lib/visits/use-visit-sharing';
import { showToast } from '@/lib/ui/toast';
import { GalleryButton } from '../collection/gallery-button';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { selectAllArtworkPhotos } from '@/db/repos/artwork-album';
import { WorkLink } from '../collection/work-link';
import { LocalVisitGalleryArtwork, matchesVisitSearch, VisitGallerySearch } from './visit-gallery';
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
  const [search, setSearch] = useState('');
  const photos = useLiveQuery(selectAllArtworkPhotos(visit.owner), [visit.owner]);
  const query = visit.works.length >= 5 ? search : '';
  const filtered = visit.works.filter((work) => matchesVisitSearch(work, query));
  const generation = useOwnerGeneration();
  const sharing = useVisitSharing(visit.localId, visit.works.map((work) => work.localId));
  const signedIn = visit.owner.startsWith('account:');
  const { controller, token } = sharing;
  useFocusEffect(useCallback(() => { if (signedIn && token && generation) void controller.load(); }, [controller, signedIn, token, generation]));
  const active = sharing.acknowledged?.status === 'active';
  const status = !signedIn ? 'Private on this device' : sharing.profileRequired ? 'Private visit'
    : sharing.error ? 'Sharing status unavailable' : active ? sharing.acknowledged?.audience === 'public' ? 'Shared publicly' : 'Shared with friends'
      : sharing.acknowledged ? 'Private visit' : 'Checking sharing status…';
  const openSharing = () => router.push({ pathname: '/visit-share/[visitId]', params: { visitId: visit.localId } });
  function stopSharing() {
    Alert.alert('Stop sharing this visit?', 'Friends will no longer be able to see this visit.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Stop sharing', style: 'destructive', onPress: () => { void controller.unshare().then((done) => { if (done) showToast('Visit is private again.'); }); } },
    ]);
  }
  return <>
    <Stack.Screen options={{ title: 'Visit' }} />
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
      <View style={detail.actions}>
        <GalleryButton label={active ? 'Edit shared visit' : 'Share visit'} variant={active ? 'outlined' : 'filled'} fullWidth={!active} onPress={openSharing} />
        {active && <GalleryButton label="View shared version" variant="outlined"
          onPress={() => router.push({ pathname: '/visit-share/[visitId]/shared', params: { visitId: visit.localId } })} />}
      </View>
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
          <GalleryButton label="Link artwork" icon="plus" onPress={() => router.push({ pathname: '/link-artwork', params: { visitId: visit.localId } })} />
        </View>
        {visit.works.length >= 5 && <VisitGallerySearch value={search} onChangeText={setSearch} />}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', columnGap: 13, rowGap: 20, paddingTop: 12 }}>
          {filtered.map((work) => {
            const album = photos.data.filter((photo) => photo.owner === visit.owner && photo.savedLocalId === work.localId && photo.visitLocalId === visit.localId);
            const cover = album.find((photo) => photo.kind === 'full') ?? album.find((photo) => photo.kind !== 'label') ?? album[0];
            return <WorkLink key={work.localId} work={work} visitId={visit.localId} style={{ width: '48%', flexShrink: 1 }}>
              <LocalVisitGalleryArtwork title={work.title} artist={work.artist} photoCount={album.length} path={cover?.path ?? work.cropPath} />
            </WorkLink>;
          })}
        </View>
        {!filtered.length && <Text style={[styles.caption, { paddingVertical: 22 }]}>{query ? 'No artworks match this search.' : 'No artworks saved on this visit. The memory still belongs here.'}</Text>}
      </View>
      {active && <GalleryButton label="Stop sharing this visit" destructive fullWidth disabled={sharing.busy} onPress={stopSharing} />}
    </VisitPage>
  </>;
}

const detail = StyleSheet.create({
  stampRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 4 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  stamp: { width: 43, height: 43, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, borderColor: '#747C6540', backgroundColor: '#E4E7DC', alignItems: 'center', justifyContent: 'center' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#E5E7DE', paddingVertical: 5, paddingHorizontal: 8, borderRadius: 20, flexShrink: 1 },
  badgeText: { fontSize: 10, lineHeight: 15, fontWeight: '500', color: '#627158', flexShrink: 1 },
  sectionTitle: { fontSize: 11, lineHeight: 17, fontWeight: '600', color: Gallery.ink },
  secondary: { fontSize: 10, lineHeight: 16, color: '#878A7B' },
});
