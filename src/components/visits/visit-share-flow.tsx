import { SharePhotoPicker } from './share-photo-picker';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { createContext, use, useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Gallery } from '@/constants/theme';
import { selectAllArtworkPhotos } from '@/db/repos/artwork-album';
import { useOwnerGeneration } from '@/lib/account/owner-store';
import { formatVisitDate } from '@/lib/journal/history';
import { useVisits } from '@/lib/journal/use-visits';
import type { VisitSummary } from '@/lib/journal/visit-summaries';
import { showToast } from '@/lib/ui/toast';
import { useVisitSharing } from '@/lib/visits/use-visit-sharing';
import { LIMITS } from '@/shared/journal/limits';
import { GalleryButton } from '../collection/gallery-button';
import { SavedWorkImage } from '../collection/saved-work-image';
import { ProfileForm } from '../social/profile-form';
import { SharedVisitProjection } from '../social/visit-screen';
import { AccountSection } from '../settings/account-section';
import { ToastLayer } from '../toast';
import { VisitMessage, VisitPage, VisitSymbol, visitStyles as styles } from './visit-ui';

type Sharing = ReturnType<typeof useVisitSharing>;
const ShareContext = createContext<{ sharing: Sharing; visit: VisitSummary } | null>(null);
function useShareFlow() {
  const value = use(ShareContext);
  if (!value) throw new Error('Visit sharing requires a visit');
  return value;
}
export function VisitShareLayout() {
  const { visitId } = useLocalSearchParams<{ visitId: string }>();
  const { owner, visits, loading, error } = useVisits();
  const visit = visits.find((row) => row.localId === visitId);
  if (!visit) return <VisitPage><VisitMessage loading={loading} action="Done" onAction={() => router.dismiss()}>
    {loading ? 'Loading visit…' : error ? 'This visit could not load.' : 'This visit is unavailable for this account.'}
  </VisitMessage></VisitPage>;
  return <ShareProvider key={`${owner}:${visitId}`} visit={visit} />;
}
function ShareProvider({ visit }: { visit: VisitSummary }) {
  const sharing = useVisitSharing(visit.localId, visit.works.map((work) => work.localId));
  const generation = useOwnerGeneration();
  const { controller, token } = sharing;
  useEffect(() => { if (visit.owner.startsWith('account:') && token) void controller.load(); }, [controller, token, generation, visit.owner]);
  return <ShareContext value={{ sharing, visit }}>
    <View style={{ flex: 1 }}>
      <Stack screenOptions={{ headerTintColor: Gallery.accent, headerStyle: { backgroundColor: Gallery.paper },
        contentStyle: { backgroundColor: Gallery.paper }, headerShadowVisible: false }}>
        <Stack.Screen name="index" options={{ title: 'Share visit', headerRight: () => <GalleryButton label="Done" onPress={() => router.dismiss()} /> }} />
        <Stack.Screen name="preview" options={{ title: 'Sharing preview', headerBackTitle: 'Edit' }} />
        <Stack.Screen name="shared" options={{ title: 'Shared visit', headerRight: () => <GalleryButton label="Done" onPress={() => router.dismiss()} /> }} />
      </Stack>
      <ToastLayer offset={0} />
    </View>
  </ShareContext>;
}
function ShareError({ sharing }: { sharing: Sharing }) {
  return sharing.error ? <Text selectable accessibilityRole="alert" style={styles.error}>{sharing.error}</Text> : null;
}
function PrivacyNote({ children }: { children: string }) {
  return <View style={{ flexDirection: 'row', gap: 7 }}><VisitSymbol name="lock" size={13} color="#78816D" /><Text style={[styles.fine, { flex: 1 }]}>{children}</Text></View>;
}
export function VisitShareScreen() {
  const { sharing, visit } = useShareFlow();
  const [photoWorkId, setPhotoWorkId] = useState<string>();
  const [creatingProfile, setCreatingProfile] = useState(false);
  const photos = useLiveQuery(selectAllArtworkPhotos(visit.owner), [visit.owner]);
  const { controller, draft } = sharing;
  if (!visit.owner.startsWith('account:')) return <VisitPage><Text style={styles.body}>Sign in to share visits with friends.</Text><AccountSection /></VisitPage>;
  if (sharing.profileRequired) return creatingProfile ? <ProfileForm introduction="Create a profile so friends can recognize you. You will review this visit before sharing it." onCreated={() => { setCreatingProfile(false); void controller.load(); }} />
    : <VisitPage><Text style={styles.body}>Create a profile to share visits with friends.</Text><GalleryButton label="Create profile" variant="filled" onPress={() => setCreatingProfile(true)} /></VisitPage>;
  if (!draft) return <VisitPage><VisitMessage loading={sharing.busy} action="Try again" onAction={() => { void controller.load(); }}>Preparing sharing…</VisitMessage><ShareError sharing={sharing} /></VisitPage>;
  const photoWork = visit.works.find((work) => work.localId === photoWorkId);
  if (photoWork) return <SharePhotoPicker work={photoWork} visitId={visit.localId} selected={draft.photoSelections?.find((row) => row.saveLocalId === photoWork.localId)?.photoLocalIds ?? []}
    onDone={() => setPhotoWorkId(undefined)} onChange={(ids) => {
      controller.edit({ photoSelections: [...(draft.photoSelections ?? []).filter((row) => row.saveLocalId !== photoWork.localId), ...(ids.length ? [{ saveLocalId: photoWork.localId, photoLocalIds: ids }] : [])] });
    }} />;
  const selected = new Set(draft.saveLocalIds);
  const highlights = (draft.highlightLocalIds ?? []).filter((id) => selected.has(id));
  const lead = [...highlights, ...draft.saveLocalIds.filter((id) => !highlights.includes(id))].slice(0, 3)
    .flatMap((id) => visit.works.filter((work) => work.localId === id));
  const active = sharing.acknowledged?.status === 'active';
  const photoTotal = (saveLocalId: string) => photos.data.filter((photo) => photo.savedLocalId === saveLocalId && photo.visitLocalId === visit.localId).length;
  function toggleSelection(id: string) {
    if (selected.has(id)) controller.edit({ saveLocalIds: draft!.saveLocalIds.filter((value) => value !== id) });
    else if (selected.size < LIMITS.selectedSaves) controller.edit({ saveLocalIds: [...draft!.saveLocalIds, id] });
  }
  function toggleHighlight(id: string) {
    if (highlights.includes(id)) controller.edit({ highlightLocalIds: highlights.filter((value) => value !== id) });
    else if (highlights.length >= 3) showToast('Choose up to 3 highlights. Remove one to choose another.');
    else controller.edit({ highlightLocalIds: [...highlights, id] });
  }
  async function preview() {
    if (await controller.preview()) router.push({ pathname: '/visit-share/[visitId]/preview', params: { visitId: visit.localId } });
  }
  return <FlatList data={visit.works} keyExtractor={(work) => work.localId} contentInsetAdjustmentBehavior="automatic"
    keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive" contentContainerStyle={styles.content}
    ListHeaderComponent={<View style={{ gap: 18 }}>
      <Text style={[styles.title, { letterSpacing: -0.8 }]}>Choose what travels.</Text>
      <Text style={styles.caption}>{visit.venueName}{'\n'}{formatVisitDate(visit.visitedOn)} · friends only</Text>
      {active && <View style={styles.card}>
        <Text style={styles.body}>Shared with friends</Text>
        <GalleryButton label="View shared visit" disabled={sharing.busy} onPress={() => router.push({ pathname: '/visit-share/[visitId]/shared', params: { visitId: visit.localId } })} />
        <GalleryButton label="Stop sharing" destructive disabled={sharing.busy} onPress={() => Alert.alert('Stop sharing this visit?', 'Friends will no longer be able to see this visit.',
          [{ text: 'Cancel', style: 'cancel' }, { text: 'Stop sharing', style: 'destructive', onPress: () => { void controller.unshare().then((done) => { if (done) showToast('Visit is private again.'); }); } }])} />
      </View>}
      {sharing.acknowledged?.removed ? <Text style={styles.error}>This share is no longer available.</Text> : <>
        <View style={styles.sectionLabel}><Text style={share.sectionTitle}>Feed preview</Text><Text style={styles.fine}>Up to 3 highlights</Text></View>
        <View style={share.lead}>
          {lead.map((work) => <SavedWorkImage key={work.localId} contain path={work.cropPath} title={work.title} style={share.leadThumb} />)}
          <Text style={share.leadCopy}>{selected.size > 3 ? `+${selected.size - 3} more inside the visit` : selected.size ? 'Every selected artwork opens in the visit' : 'Select artworks to fill the feed card'}</Text>
        </View>
        <Text style={styles.fine}>Tap a numbered circle to remove a highlight, then a star to choose another. Empty preview spots use the next selected artwork.</Text>
        <View style={styles.sectionLabel}><Text style={share.sectionTitle}>Shared artworks</Text>
          <Text style={styles.fine}>{selected.size}/{LIMITS.selectedSaves} selected</Text></View>
        <GalleryButton label="Deselect all" disabled={sharing.busy || !selected.size} onPress={() => controller.edit({ saveLocalIds: [] })} />
        {!visit.works.length && <Text style={styles.caption}>You can share a visit with no artworks.</Text>}
      </>}
      <ShareError sharing={sharing} />
      {sharing.conflict && <GalleryButton label="Refresh sharing status" disabled={sharing.busy} onPress={() => { void controller.load(); }} />}
    </View>}
    renderItem={({ item }) => {
      const on = selected.has(item.localId), rank = highlights.indexOf(item.localId);
      const chosen = draft.photoSelections?.find((row) => row.saveLocalId === item.localId)?.photoLocalIds.length ?? 0;
      const total = photoTotal(item.localId);
      return <View style={share.item}>
        <View style={share.itemTop}>
          <Pressable accessibilityRole="checkbox" accessibilityLabel={`Share ${item.title}`} accessibilityState={{ checked: on, disabled: sharing.busy }}
            disabled={sharing.busy || (!on && selected.size >= LIMITS.selectedSaves)} onPress={() => toggleSelection(item.localId)} style={share.choice}>
            <VisitSymbol name={on ? 'checkmark.circle.fill' : 'circle'} size={20} color={on ? '#596F49' : Gallery.muted} />
            <SavedWorkImage contain path={item.cropPath} title={item.title} style={share.thumb} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={2} style={share.itemTitle}>{item.title}</Text>
              <Text numberOfLines={1} style={share.itemArtist}>{item.artist || 'Artist unknown'}</Text>
            </View>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`${rank >= 0 ? 'Remove highlight' : 'Highlight'} ${item.title}`}
            accessibilityState={{ selected: rank >= 0, disabled: !on || sharing.busy }} disabled={!on || sharing.busy} onPress={() => toggleHighlight(item.localId)}
            style={[share.highlight, rank >= 0 && share.highlightOn, !on && { opacity: 0.3 }]}>
            {rank >= 0 ? <Text style={share.highlightRank}>{rank + 1}</Text> : <VisitSymbol name="star" size={15} color="#6F7564" />}
          </Pressable>
        </View>
        <View style={share.itemBottom}>
          <GalleryButton label={`${chosen} of ${total} ${total === 1 ? 'photo' : 'photos'}`} icon="chevron.right" iconPosition="trailing" disabled={!on || sharing.busy}
            onPress={() => setPhotoWorkId(item.localId)} />
          <Text style={share.hint}>{on ? rank >= 0 ? 'Feed highlight' : 'Inside the visit' : 'Not shared'}</Text>
        </View>
      </View>;
    }}
    ListFooterComponent={<View style={{ gap: 12, paddingTop: 8 }}>
      <Text style={styles.caption}>A reflection for friends (optional)</Text>
      <TextInput accessibilityLabel="Shared reflection" placeholder="What stayed with you?" value={draft.reflection}
        multiline maxLength={LIMITS.sharedReflection} editable={!sharing.busy} style={[styles.input, styles.reflection]}
        onChangeText={(reflection) => controller.edit({ reflection })} />
      <Text style={styles.fine}>{draft.reflection.length}/{LIMITS.sharedReflection} characters</Text>
      <PrivacyNote>Only selected photos from this visit are shared. Private notes, wall-label photos, and photos from other visits are not added automatically. Adding a photo later will not share it.</PrivacyNote>
      <GalleryButton label={sharing.busy ? 'Preparing…' : sharing.conflict ? 'Refresh preview' : 'Preview shared visit'} variant="filled" fullWidth
        disabled={sharing.busy || sharing.acknowledged?.removed} onPress={() => { void preview(); }} />
      <Text style={styles.fine}>The preview is not a limit. The full visit shows every artwork you select, ordered by highlights first.</Text>
    </View>} />;
}
export function VisitSharePreviewScreen() {
  const { sharing } = useShareFlow();
  const { preview, controller } = sharing;
  const active = sharing.acknowledged?.status === 'active';
  async function publish() {
    if (await controller.publish()) { showToast(active ? 'Shared visit updated.' : 'Visit shared with friends.'); router.back(); }
  }
  if (!preview) return <VisitPage><ShareError sharing={sharing} /><VisitMessage action="Back to selection" onAction={() => router.back()}>Refresh the preview before sharing.</VisitMessage></VisitPage>;
  // The server previews in selection order but publishes highlights first; show friends' order.
  const highlights = sharing.draft?.highlightLocalIds ?? [];
  const ordered = [...highlights.flatMap((id) => preview.artworks.filter((item) => item.saveLocalId === id)), ...preview.artworks.filter((item) => !highlights.includes(item.saveLocalId))];
  return <SharedVisitProjection banner={{ title: 'Preview before sharing', copy: 'Only these artworks, selected photos, and this reflection. No other visits or private notes.' }}
    author={preview.author} venue={preview.venue} visitedOn={preview.visitedOn} reflection={preview.reflection} token={sharing.token}
    artworks={ordered.map((item) => ({ key: item.saveLocalId, title: item.artwork.title, artist: item.artwork.artist, photos: item.photos ?? [] }))}
    footer={<View style={share.confirm}>
      <ShareError sharing={sharing} />
      <GalleryButton label={sharing.busy ? 'Sharing…' : active ? 'Update shared visit' : 'Share with friends'} variant="filled" fullWidth
        disabled={sharing.busy || sharing.conflict} onPress={() => { void publish(); }} />
      <PrivacyNote>Preview highlights affect the feed card, not which artworks appear in this visit. Only your friends can see it; your private journal stays private.</PrivacyNote>
    </View>} />;
}
export function VisitSharedScreen() {
  const { sharing } = useShareFlow();
  const { controller, shared } = sharing;
  useEffect(() => { void controller.view(); }, [controller]);
  if (!shared) return <VisitPage>
    <VisitMessage loading={sharing.busy} action="Try again" onAction={() => { void controller.view(); }}>Loading shared visit…</VisitMessage>
    <ShareError sharing={sharing} />
  </VisitPage>;
  return <SharedVisitProjection banner={{ title: 'What friends can see', copy: 'Only these artworks, selected photos, and this reflection. No other visits or private notes.' }}
    author={shared.author} venue={shared.venue} visitedOn={shared.visitedOn} reflection={shared.reflection} token={sharing.token}
    artworks={shared.artworks.page.map((item) => ({ key: item.itemId, title: item.artwork.title, artist: item.artwork.artist, photos: item.photos ?? [] }))}
    footer={<ShareError sharing={sharing} />} />;
}

const share = StyleSheet.create({
  sectionTitle: { fontSize: 11, lineHeight: 17, fontWeight: '600', color: Gallery.ink },
  lead: { flexDirection: 'row', alignItems: 'center', gap: 7, padding: 10, borderRadius: 9, backgroundColor: '#E5E9DE' },
  leadThumb: { width: 54, height: 54, borderRadius: 4, backgroundColor: '#DDE2D6' },
  leadCopy: { flex: 1, marginLeft: 'auto', textAlign: 'right', fontSize: 10, lineHeight: 16, color: '#66765A' },
  item: { borderWidth: StyleSheet.hairlineWidth, borderColor: '#26232022', borderRadius: 11, marginBottom: 11, overflow: 'hidden' },
  itemTop: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 10, paddingTop: 9, paddingBottom: 5 },
  choice: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 9, minHeight: 44 },
  thumb: { width: 44, height: 44, borderRadius: 4, backgroundColor: Gallery.fill },
  itemTitle: { fontSize: 12, lineHeight: 17, color: Gallery.ink },
  itemArtist: { fontSize: 10, lineHeight: 15, color: Gallery.muted, marginTop: 2 },
  highlight: { width: 36, height: 36, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, borderColor: '#26232028', alignItems: 'center', justifyContent: 'center' },
  highlightOn: { backgroundColor: '#5E714F', borderColor: '#5E714F' },
  highlightRank: { fontSize: 12, fontWeight: '600', color: '#F7F8EF' },
  itemBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6, paddingLeft: 35, paddingRight: 12, paddingBottom: 4 },
  hint: { fontSize: 9, lineHeight: 14, color: Gallery.muted, textAlign: 'right' },
  confirm: { gap: 12, paddingTop: 15, marginTop: 15, borderTopWidth: StyleSheet.hairlineWidth, borderColor: Gallery.separator },
});
