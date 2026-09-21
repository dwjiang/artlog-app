import { GalleryBackToolbar } from '../gallery-back-toolbar';
import { SharePhotoPicker } from './share-photo-picker';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { createContext, use, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { ThemedText as Text } from '@/components/themed-text';
import { Gallery, NavigationTheme, Radius } from '@/constants/theme';
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
import { cropSyncing } from '@/lib/account/photo-sync';
import { ProfileForm } from '../social/profile-form';
import { SocialState } from '../social/social-state';
import { SharedVisitProjection } from '../social/visit-screen';
import { signInRoute } from '@/lib/account/sign-in-context';
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
      <Stack screenOptions={NavigationTheme}>
        <Stack.Screen name="index" options={{ title: 'Share visit', headerRight: () => <GalleryButton label="Done" fullWidth={false} onPress={() => router.dismiss()} /> }} />
        <Stack.Screen name="preview" options={{ title: 'Preview', headerBackTitle: 'Edit' }} />
        <Stack.Screen name="shared" options={{ title: 'Shared visit', headerRight: () => <GalleryButton label="Done" fullWidth={false} onPress={() => router.dismiss()} /> }} />
      </Stack>
      <ToastLayer offset={0} />
    </View>
  </ShareContext>;
}
function ShareError({ sharing }: { sharing: Sharing }) {
  return sharing.error ? <Text selectable accessibilityRole="alert" style={styles.error}>{sharing.error}</Text> : null;
}
function PrivacyNote({ children }: { children: string }) {
  return <View style={{ flexDirection: 'row', gap: 7 }}><VisitSymbol name="lock" size={13} color={Gallery.muted} /><Text style={[styles.fine, { flex: 1 }]}>{children}</Text></View>;
}
function GuestVisitSignIn({ visitId }: { visitId: string }) {
  useEffect(() => { router.replace(signInRoute('visit', visitId)); }, [visitId]);
  return <VisitPage><VisitMessage loading>Opening sign-in…</VisitMessage></VisitPage>;
}
export function VisitShareScreen() {
  const { sharing, visit } = useShareFlow();
  const [photoWorkId, setPhotoWorkId] = useState<string>();
  const [creatingProfile, setCreatingProfile] = useState(false);
  const photos = useLiveQuery(selectAllArtworkPhotos(visit.owner), [visit.owner]);
  const { controller, draft } = sharing;
  if (visit.visibility === 'private') return <VisitPage><SocialState title="This visit is private." detail="Make it Public on the visit page before publishing."
    action="Back to visit" onAction={() => router.dismiss()} /></VisitPage>;
  if (!visit.owner.startsWith('account:')) return <GuestVisitSignIn visitId={visit.localId} />;
  if (sharing.profileRequired) return creatingProfile ? <ProfileForm introduction="Create a profile so people can recognize you. You will review this visit before sharing it." onCreated={() => { setCreatingProfile(false); void controller.load(); }} />
    : <VisitPage><Text style={styles.body}>Create a profile to publish this visit.</Text><GalleryButton label="Create profile" variant="filled" onPress={() => setCreatingProfile(true)} /></VisitPage>;
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
  function previewPhotoPath(saveLocalId: string) {
    const selectedIds = draft!.photoSelections?.find((row) => row.saveLocalId === saveLocalId)?.photoLocalIds ?? [];
    for (const localId of selectedIds) {
      const photo = photos.data.find((row) => row.localId === localId && row.owner === visit.owner
        && row.savedLocalId === saveLocalId && row.visitLocalId === visit.localId && row.deletedAt === null);
      if (photo) return photo.path;
    }
    return null;
  }
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
      <Text style={[styles.title, { letterSpacing: -0.8 }]}>Choose what to share.</Text>
      <Text style={styles.caption}>{visit.venueName}{'\n'}{formatVisitDate(visit.visitedOn)} · Public</Text>
      {active && <View style={styles.card}>
        <Text style={styles.body}>Public</Text>
        <GalleryButton label="View shared visit" disabled={sharing.busy} onPress={() => router.push({ pathname: '/visit-share/[visitId]/shared', params: { visitId: visit.localId } })} />
      </View>}
      <Text style={styles.caption}>Publishing makes this visit, its selected photos and notes public, including to people without an account.</Text>
      {sharing.acknowledged?.removed ? <Text style={styles.error}>This share is no longer available.</Text> : <>
        <View style={styles.sectionLabel}><Text style={share.sectionTitle}>Feed preview</Text><Text style={styles.fine}>Up to 3 highlights</Text></View>
        <View style={share.lead}>
          {lead.map((work) => <SavedWorkImage key={work.localId} contain path={previewPhotoPath(work.localId)} title={work.title} style={share.leadThumb} />)}
          <Text style={share.leadCopy}>{selected.size > 3 ? `+${selected.size - 3} more inside the visit` : selected.size ? 'Every selected artwork opens in the visit' : 'Select artworks to fill the feed card'}</Text>
        </View>
        <Text style={styles.fine}>Star up to 3 artworks to lead your visit.</Text>
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
            <VisitSymbol name={on ? 'checkmark.circle.fill' : 'circle'} size={20} color={on ? Gallery.accent : Gallery.muted} />
            <SavedWorkImage contain path={item.cropPath} syncing={cropSyncing(item)} title={item.title} style={share.thumb} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={share.itemTitle}>{item.title}</Text>
              <Text style={share.itemArtist}>{item.artist || 'Artist unknown'}</Text>
            </View>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`${rank >= 0 ? 'Remove highlight' : 'Highlight'} ${item.title}`}
            accessibilityState={{ selected: rank >= 0, disabled: !on || sharing.busy }} disabled={!on || sharing.busy} onPress={() => toggleHighlight(item.localId)}
            style={[share.highlight, rank >= 0 && share.highlightOn, !on && { opacity: 0.3 }]}>
            {rank >= 0 ? <Text style={share.highlightRank}>{rank + 1}</Text> : <VisitSymbol name="star" size={15} color={Gallery.muted} />}
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
      <Text accessibilityRole="header" style={styles.heading}>Notes</Text>
      {draft.reflection ? <Text selectable style={styles.body}>{draft.reflection}</Text> : <Text style={styles.caption}>No notes added.</Text>}
      <Text style={styles.fine}>Notes follow the visit’s visibility. Edit them on the visit page.</Text>
      <PrivacyNote>Only selected photos from this visit are shared. Artwork notes, wall-label photos, and photos from other visits are not added automatically. Adding a photo later will not share it.</PrivacyNote>
      <GalleryButton label={sharing.conflict ? 'Refresh preview' : 'Preview shared visit'} busy={sharing.busy} busyLabel="Preparing preview…" variant="filled" fullWidth
        disabled={sharing.busy || sharing.acknowledged?.removed} onPress={() => { void preview(); }} />
    </View>} />;
}
export function VisitSharePreviewScreen() {
  const { sharing, visit } = useShareFlow();
  const { preview, controller } = sharing;
  const active = sharing.acknowledged?.status === 'active';
  async function publish() {
    if (await controller.publish()) { showToast(active ? 'Shared visit updated.' : 'Visit shared publicly.'); router.replace({ pathname: '/visit-share/[visitId]/shared', params: { visitId: visit.localId } }); }
  }
  if (!preview) return <VisitPage><ShareError sharing={sharing} /><VisitMessage action="Back to selection" onAction={() => router.back()}>Refresh the preview before sharing.</VisitMessage></VisitPage>;
  // Match the published order, with highlights first.
  const highlights = sharing.draft?.highlightLocalIds ?? [];
  const ordered = [...highlights.flatMap((id) => preview.artworks.filter((item) => item.saveLocalId === id)), ...preview.artworks.filter((item) => !highlights.includes(item.saveLocalId))];
  return <><GalleryBackToolbar /><SharedVisitProjection banner={{ title: 'Only this will be shared', copy: 'These artworks, selected photos, and visit notes. Other visits and artwork notes stay private.' }}
    note="This visit will appear on public Home, including for people without an account; your private journal stays private."
    author={preview.author} venue={preview.venue} visitedOn={preview.visitedOn} reflection={preview.reflection} token={sharing.token}
    artworks={ordered.map((item) => ({ key: item.saveLocalId, title: item.artwork.title, artist: item.artwork.artist, photos: item.photos ?? [] }))}
    footer={<View style={share.confirm}>
      <ShareError sharing={sharing} />
      <GalleryButton label={active ? 'Update shared visit' : 'Publish visit'} busy={sharing.busy} busyLabel="Sharing…" variant="filled" fullWidth
        disabled={sharing.busy || sharing.conflict} onPress={() => { void publish(); }} />
      <GalleryButton label="Edit selection" fullWidth disabled={sharing.busy} onPress={() => router.back()} />
    </View>} /></>;
}
export function VisitSharedScreen() {
  const { sharing, visit } = useShareFlow();
  const { controller, shared } = sharing;
  const signedIn = visit.owner.startsWith('account:');
  useEffect(() => { if (signedIn) void controller.view(); }, [controller, signedIn]);
  if (!signedIn) return <VisitPage><SocialState title="Share a visit." detail="Sign in to publish this visit." icon="person.2"
    action="Sign in" onAction={() => router.push(signInRoute('visit'))} /></VisitPage>;
  if (sharing.profileRequired) return <VisitPage><VisitMessage action="Back to selection" onAction={() => router.replace({ pathname: '/visit-share/[visitId]', params: { visitId: visit.localId } })}>
    Create a profile before sharing this visit.
  </VisitMessage></VisitPage>;
  const unavailable = sharing.acknowledged && (sharing.acknowledged.status !== 'active' || sharing.acknowledged.removed);
  if (!shared) return <VisitPage>
    <VisitMessage loading={sharing.busy} action={unavailable ? 'Back to selection' : 'Try again'}
      onAction={() => { if (unavailable) router.replace({ pathname: '/visit-share/[visitId]', params: { visitId: visit.localId } }); else void controller.view(); }}>
      {sharing.busy ? 'Loading shared visit…' : unavailable ? 'This visit is not currently shared.' : 'The shared visit could not load.'}
    </VisitMessage>
    {!unavailable && <ShareError sharing={sharing} />}
  </VisitPage>;
  return <SharedVisitProjection banner={{ title: 'What anyone can see', copy: 'These artworks, selected photos, and visit notes. Other visits and artwork notes stay private.' }}
    author={shared.author} venue={shared.venue} visitedOn={shared.visitedOn} reflection={shared.reflection} token={sharing.token}
    artworks={shared.artworks.page.map((item) => ({ key: item.itemId, title: item.artwork.title, artist: item.artwork.artist, photos: item.photos ?? [] }))}
    footer={<ShareError sharing={sharing} />} />;
}

const share = StyleSheet.create({
  sectionTitle: { fontSize: 13, lineHeight: 18, fontWeight: '600', color: Gallery.ink },
  lead: { flexDirection: 'row', alignItems: 'center', gap: 7, padding: 10, borderRadius: 9, backgroundColor: Gallery.fill },
  leadThumb: { width: 54, height: 54, borderRadius: 2, backgroundColor: Gallery.fill },
  leadCopy: { flex: 1, marginLeft: 'auto', textAlign: 'right', fontSize: 13, lineHeight: 18, color: Gallery.muted },
  item: { borderWidth: StyleSheet.hairlineWidth, borderColor: Gallery.softBorder, borderRadius: Radius.card, backgroundColor: Gallery.surface, marginBottom: 12, overflow: 'hidden' },
  itemTop: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 10, paddingTop: 9, paddingBottom: 5 },
  choice: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 9, minHeight: 44 },
  thumb: { width: 52, height: 60, borderRadius: 2, backgroundColor: Gallery.fill },
  itemTitle: { fontSize: 14, lineHeight: 20, fontWeight: '600', color: Gallery.ink },
  itemArtist: { fontSize: 13, lineHeight: 18, color: Gallery.muted, marginTop: 2 },
  highlight: { minWidth: 44, minHeight: 44, borderRadius: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: Gallery.separator, alignItems: 'center', justifyContent: 'center' },
  highlightOn: { backgroundColor: Gallery.highlight, borderColor: Gallery.highlight },
  highlightRank: { fontSize: 13, fontWeight: '600', color: Gallery.ink },
  itemBottom: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 6, paddingLeft: 35, paddingRight: 12, paddingBottom: 4 },
  hint: { fontSize: 13, lineHeight: 18, color: Gallery.muted, textAlign: 'right' },
  confirm: { gap: 4, paddingTop: 12 },
});
