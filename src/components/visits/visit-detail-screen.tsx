import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Gallery } from '@/constants/theme';
import { useOwnerGeneration } from '@/lib/account/owner-store';
import { formatVisitDate } from '@/lib/journal/history';
import { useVisits } from '@/lib/journal/use-visits';
import type { VisitSummary } from '@/lib/journal/visit-summaries';
import { useVisitSharing } from '@/lib/visits/use-visit-sharing';
import { GalleryButton } from '../collection/gallery-button';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { selectAllArtworkPhotos } from '@/db/repos/artwork-album';
import { WallFrame } from '../collection/wall-frame';
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
  const [search, setSearch] = useState('');
  const photos = useLiveQuery(selectAllArtworkPhotos(visit.owner), [visit.owner]);
  const filtered = visit.works.filter((work) => `${work.title} ${work.artist}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
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
          <GalleryButton label="Link artwork" icon="plus" onPress={() => router.push({ pathname: '/link-artwork', params: { visitId: visit.localId } })} />
        </View>
        {visit.works.length >= 5 && <TextInput accessibilityLabel="Search visit artworks" placeholder="Search artworks or artists" value={search} onChangeText={setSearch} style={{ padding: 13, backgroundColor: Gallery.fill, borderRadius: 10, marginVertical: 12, color: Gallery.ink }} />}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 20, paddingTop: 20 }}>
          {filtered.map((work) => {
            const album = photos.data.filter((photo) => photo.owner === visit.owner && photo.savedLocalId === work.localId && photo.visitLocalId === visit.localId);
            const cover = album.find((photo) => photo.kind === 'full') ?? album[0];
            return <WorkLink key={work.localId} work={work} visitId={visit.localId} style={{ width: '46%', gap: 8 }}>
              <View style={{ alignItems: 'center', justifyContent: 'center', height: 170, backgroundColor: '#E4E7DD', borderRadius: 8 }}>
                <WallFrame frame="gilt" width={116}><SavedWorkImage contain path={cover?.path ?? work.cropPath} title={work.title} style={{ width: 108, height: 120 }} /></WallFrame>
                <Text style={{ position: 'absolute', bottom: 7, right: 7, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 3, backgroundColor: Gallery.paper, color: Gallery.muted, fontSize: 10 }}>{album.length} {album.length === 1 ? 'photo' : 'photos'}</Text>
              </View>
              <Text numberOfLines={2} style={detail.workTitle}>{work.title}</Text><Text style={detail.artist}>{work.artist || 'Artist unknown'}</Text>
            </WorkLink>;
          })}
        </View>
        {!filtered.length && <Text style={[styles.caption, { paddingVertical: 22 }]}>{search ? 'No matching artworks.' : 'No artworks saved on this visit. The memory still belongs here.'}</Text>}
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
