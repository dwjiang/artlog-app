import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { ThemedText as Text } from '@/components/themed-text';
import { Gallery, Typography } from '@/constants/theme';
import { HighlightHeading } from '../highlight-heading';
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
import { cropSyncing } from '@/lib/account/photo-sync';
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
  const [searching, setSearching] = useState(false);
  const { fontScale } = useWindowDimensions();
  const photos = useLiveQuery(selectAllArtworkPhotos(visit.owner), [visit.owner]);
  const query = searching ? search : '';
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
    <Stack.Screen options={{ title: '' }} />
    <Stack.Toolbar placement="right"><Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel="Visit options" hidesSharedBackground tintColor={Gallery.ink}>
      <Stack.Toolbar.MenuAction icon="plus" onPress={() => router.push({ pathname: '/link-artwork', params: { visitId: visit.localId } })}>Link artwork</Stack.Toolbar.MenuAction>
      <Stack.Toolbar.MenuAction icon="square.and.pencil" onPress={() => router.push({ pathname: '/visit-reflection', params: { visitId: visit.localId } })}>Edit reflection</Stack.Toolbar.MenuAction>
    </Stack.Toolbar.Menu></Stack.Toolbar>
    <VisitPage>
      <View style={detail.stampRow}>
        <View style={detail.badge}><VisitSymbol name={sharing.acknowledged?.status === 'active' ? 'person.2' : 'lock'} size={11} color={Gallery.ink} />
          <Text style={detail.badgeText}>{status}</Text>
        </View>
      </View>
      <View style={{ gap: 4 }}>
        <Text selectable accessibilityRole="header" style={[Typography.pageTitle, { color: Gallery.ink, fontSize: 42, lineHeight: 50 }]}>{visit.venueName}</Text>
        <Text selectable style={styles.caption}>{formatVisitDate(visit.visitedOn)}{visit.location ? ` · ${visit.location}` : ''}</Text>
      </View>
      <View style={detail.actions}>
        <GalleryButton label={active ? 'Edit shared visit' : 'Share visit'} variant={active ? 'outlined' : 'filled'} fullWidth={!active} onPress={openSharing} />
        {active && <GalleryButton label="View shared version" variant="outlined"
          onPress={() => router.push({ pathname: '/visit-share/[visitId]/shared', params: { visitId: visit.localId } })} />}
      </View>
      <View>
        <View style={styles.sectionLabel}>
          <HighlightHeading>Your reflection</HighlightHeading>
          <View style={{ flexDirection: 'row', gap: 4, alignItems: 'center' }}><VisitSymbol name="lock" size={10} /><Text style={detail.secondary}>Only you</Text></View>
        </View>
        {!!visit.reflection && <Text selectable style={[styles.body, { color: Gallery.ink, fontSize: 15, lineHeight: 21, marginBottom: 0 }]}>{visit.reflection}</Text>}
        <GalleryButton label={visit.reflection ? 'Edit reflection' : 'Add reflection'}
          onPress={() => router.push({ pathname: '/visit-reflection', params: { visitId: visit.localId } })} />
      </View>
      <View>
        <View style={styles.sectionLabel}>
          <Text accessibilityRole="header" style={detail.sectionTitle}>{visit.works.length} {visit.works.length === 1 ? 'artwork' : 'artworks'} saved</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={searching ? 'Hide artwork search' : 'Search visit artworks'} onPress={() => setSearching((value) => !value)}
            style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><VisitSymbol name="magnifyingglass" size={22} color={Gallery.ink} /></Pressable>
        </View>
        {searching && <VisitGallerySearch value={search} onChangeText={setSearch} />}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', columnGap: 13, rowGap: 20, paddingTop: 4 }}>
          {filtered.map((work) => {
            const album = photos.data.filter((photo) => photo.owner === visit.owner && photo.savedLocalId === work.localId && photo.visitLocalId === visit.localId);
            const cover = album.find((photo) => photo.kind === 'full') ?? album.find((photo) => photo.kind !== 'label') ?? album[0];
            return <WorkLink key={work.localId} work={work} visitId={visit.localId} style={{ width: fontScale > 1.4 ? '100%' : '48%', flexShrink: 1 }}>
              <LocalVisitGalleryArtwork title={work.title} artist={work.artist} photoCount={album.length} path={cover?.path ?? work.cropPath} syncing={!cover && cropSyncing(work)} />
            </WorkLink>;
          })}
        </View>
        {!filtered.length && !!query && <GalleryButton label="Clear search" onPress={() => setSearch('')} />}
        {!filtered.length && <Text style={[styles.caption, { paddingVertical: 22 }]}>{query ? 'No artworks match this search.' : 'No artworks saved on this visit. The memory still belongs here.'}</Text>}
      </View>
      {active && <GalleryButton label="Stop sharing this visit" destructive fullWidth disabled={sharing.busy} onPress={stopSharing} />}
    </VisitPage>
  </>;
}

const detail = StyleSheet.create({
  stampRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 4 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: Gallery.fill, paddingVertical: 2, paddingHorizontal: 6, borderRadius: 2, flexShrink: 1 },
  badgeText: { fontSize: 13, lineHeight: 18, fontWeight: '500', color: Gallery.ink, flexShrink: 1 },
  sectionTitle: { ...Typography.section, color: Gallery.ink },
  secondary: { fontSize: 13, lineHeight: 18, color: Gallery.muted },
});
