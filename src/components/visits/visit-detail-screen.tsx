import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { ThemedText as Text } from '@/components/themed-text';
import { Gallery, Typography } from '@/constants/theme';
import { captureOwner, useOwnerGeneration } from '@/lib/account/owner-store';
import { formatVisitDate } from '@/lib/journal/history';
import { useVisits } from '@/lib/journal/use-visits';
import { markVisitSeen } from '@/lib/journal/visit-seen';
import type { VisitSummary } from '@/lib/journal/visit-summaries';
import { useVisitSharing } from '@/lib/visits/use-visit-sharing';
import { patchVisit } from '@/db/repos/visits';
import { flushJournal } from '@/lib/account/collection-sync';
import { GalleryButton } from '../collection/gallery-button';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { selectAllArtworkPhotos } from '@/db/repos/artwork-album';
import { WorkLink } from '../collection/work-link';
import { LocalVisitGalleryArtwork, matchesVisitSearch, VisitGallerySearch } from './visit-gallery';
import { cropSyncing } from '@/lib/account/photo-sync';
import { VisitMessage, VisitPage, visitStyles as styles } from './visit-ui';
import { VisitNotes } from './visit-notes';
import { VisitActionBar } from './visit-action-bar';

export function VisitDetailScreen() {
  const { visitId } = useLocalSearchParams<{ visitId: string }>();
  const { owner, visits, loading, error } = useVisits();
  const visit = visits.find((row) => row.localId === visitId);
  if (!visit) return <VisitPage><VisitMessage loading={loading && !error} skeleton="visit" action="Back to Collection" onAction={() => router.back()}>
    {error ? 'This visit could not load.' : loading ? 'Loading visit…' : 'This visit is unavailable for this account.'}
  </VisitMessage></VisitPage>;
  return <VisitDetail key={`${owner}:${visitId}`} visit={visit} />;
}
function VisitDetail({ visit }: { visit: VisitSummary }) {
  // Only a closed visit counts as seen; one viewed while open is still new once it closes on its own.
  useEffect(() => { if (visit.endedAt !== null) markVisitSeen(visit.localId, visit.owner); }, [visit.localId, visit.owner, visit.endedAt]);
  const [search, setSearch] = useState('');
  const { fontScale } = useWindowDimensions();
  const photos = useLiveQuery(selectAllArtworkPhotos(visit.owner), [visit.owner]);
  const filtered = visit.works.filter((work) => matchesVisitSearch(work, search));
  const generation = useOwnerGeneration();
  const sharing = useVisitSharing(visit.localId, visit.works.map((work) => work.localId));
  const signedIn = visit.owner.startsWith('account:');
  const { controller, token } = sharing;
  useFocusEffect(useCallback(() => { if (signedIn && token && generation) void controller.load(); }, [controller, signedIn, token, generation]));
  const [changingVisibility, setChangingVisibility] = useState(false);
  const [visibilityError, setVisibilityError] = useState<{ next: 'public' | 'private'; message: string }>();
  const isPublic = visit.visibility === 'public';
  const active = isPublic && sharing.acknowledged?.status === 'active';
  const pendingPrivate = signedIn && !isPublic && visit.syncedAt === null;
  const openSharing = () => router.push({ pathname: '/visit-share/[visitId]', params: { visitId: visit.localId } });
  async function changeVisibility(next: 'public' | 'private' = isPublic ? 'private' : 'public') {
    const session = captureOwner();
    if (session.owner !== visit.owner || changingVisibility) return;
    setChangingVisibility(true);
    setVisibilityError(undefined);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await patchVisit(visit.localId, { visibility: next }, visit.owner);
      if (signedIn) {
        await Promise.race([flushJournal(), new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('Visibility sync timed out')), 30_000);
        })]);
        clearTimeout(timeout);
        if (session.isCurrent() && !sharing.profileRequired) await controller.load();
      }
    } catch {
      if (session.isOwnerCurrent()) setVisibilityError({ next, message: signedIn ? 'Visibility could not sync. A published visit may still be visible.' : 'Visibility could not save. Try again.' });
    } finally {
      clearTimeout(timeout);
      if (session.isOwnerCurrent()) setChangingVisibility(false);
    }
  }
  return <>
    <Stack.Screen options={{ title: '' }} />
    <Stack.Toolbar placement="right"><Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel="Visit options" hidesSharedBackground tintColor={Gallery.ink}>
      <Stack.Toolbar.MenuAction icon="plus" onPress={() => router.push({ pathname: '/link-artwork', params: { visitId: visit.localId } })}>Link artwork</Stack.Toolbar.MenuAction>
      {active && <Stack.Toolbar.MenuAction icon="globe"
        onPress={() => router.push({ pathname: '/visit-share/[visitId]/shared', params: { visitId: visit.localId } })}>View shared version</Stack.Toolbar.MenuAction>}
    </Stack.Toolbar.Menu></Stack.Toolbar>
    <View style={styles.page}>
      <VisitPage>
        {visibilityError && <View style={{ gap: 8 }}>
          <Text accessibilityRole="alert" style={styles.error}>{visibilityError.message}</Text>
          <GalleryButton label="Retry visibility" disabled={changingVisibility} onPress={() => { void changeVisibility(visibilityError.next); }} />
        </View>}
        {sharing.error && <Text accessibilityRole="alert" style={styles.error}>{sharing.error}</Text>}
        <View style={{ gap: 4 }}>
          <Text selectable accessibilityRole="header" style={[Typography.pageTitle, { color: Gallery.ink, fontSize: 42, lineHeight: 50 }]}>{visit.venueName}</Text>
          <Text selectable style={styles.caption}>{formatVisitDate(visit.visitedOn)}{visit.location ? ` · ${visit.location}` : ''}</Text>
        </View>
        {pendingPrivate && sharing.acknowledged?.status === 'active' &&
          <Text style={styles.caption}>Waiting to sync. The published visit is still visible.</Text>}
        <VisitNotes visit={visit} />
        <View>
          <View style={styles.sectionLabel}>
            <Text accessibilityRole="header" style={detail.sectionTitle}>{visit.works.length} {visit.works.length === 1 ? 'artwork' : 'artworks'} saved</Text>
          </View>
          <VisitGallerySearch value={search} onChangeText={setSearch} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', columnGap: 13, rowGap: 20, paddingTop: 4 }}>
            {filtered.map((work) => {
              const album = photos.data.filter((photo) => photo.owner === visit.owner && photo.savedLocalId === work.localId && photo.visitLocalId === visit.localId);
              const cover = album.find((photo) => photo.kind === 'full') ?? album.find((photo) => photo.kind !== 'label') ?? album[0];
              return <WorkLink key={work.localId} work={work} visitId={visit.localId} style={{ width: fontScale > 1.4 ? '100%' : '48%', flexShrink: 1 }}>
                <LocalVisitGalleryArtwork title={work.title} artist={work.artist} photoCount={album.length} path={cover?.path ?? work.cropPath} syncing={!cover && cropSyncing(work)} />
              </WorkLink>;
            })}
          </View>
          {!filtered.length && !!search && <GalleryButton label="Clear search" onPress={() => setSearch('')} />}
          {!filtered.length && <Text style={[styles.caption, { paddingVertical: 22 }]}>{search ? 'No artworks match this search.' : 'No artworks saved on this visit. The memory still belongs here.'}</Text>}
        </View>
      </VisitPage>
      <VisitActionBar isPublic={isPublic} pendingPrivate={pendingPrivate} changingVisibility={changingVisibility} sharingBusy={sharing.busy}
        onChangeVisibility={() => { void changeVisibility(); }} onSave={openSharing} />
    </View>
  </>;
}

const detail = StyleSheet.create({
  sectionTitle: { ...Typography.section, color: Gallery.ink },
});
