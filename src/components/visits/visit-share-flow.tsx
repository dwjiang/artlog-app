import { reportError } from '@/lib/observability';
import { NotePaper } from '../note-paper';
import { setStringAsync } from 'expo-clipboard';
import { patchVisit } from '@/db/repos/visits';
import { VisitArtworks, VisitFeedCard } from '../social/visit-card';
import { GalleryBackToolbar } from '../gallery-back-toolbar';
import { SharePhotoPicker } from './share-photo-picker';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { createContext, use, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { ThemedText as Text } from '@/components/themed-text';
import { Gallery, NavigationTheme } from '@/constants/theme';
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
import { SocialState } from '../social/social-state';
import { SharedVisitProjection } from '../social/visit-screen';
import { signInRoute } from '@/lib/account/sign-in-context';
import { ToastLayer } from '../toast';
import { VisitMessage, VisitPage, VisitSymbol, visitStyles as styles } from './visit-ui';

type Sharing = ReturnType<typeof useVisitSharing>;
type PublishedArtworks = NonNullable<Sharing['preview']>['artworks'];
// Publishing clears the controller's preview, so the flow keeps the artworks it just published for the success screen.
const ShareContext = createContext<{ sharing: Sharing; visit: VisitSummary; published?: PublishedArtworks; setPublished: (artworks: PublishedArtworks) => void } | null>(null);
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
  const [published, setPublished] = useState<PublishedArtworks>();
  const generation = useOwnerGeneration();
  const { controller, token } = sharing;
  useEffect(() => { if (visit.owner.startsWith('account:') && token) void controller.load(); }, [controller, token, generation, visit.owner]);
  return <ShareContext value={{ sharing, visit, published, setPublished }}>
    <View style={{ flex: 1 }}>
      <Stack screenOptions={NavigationTheme}>
        <Stack.Screen name="index" options={{ title: 'Share visit', headerRight: () => <GalleryButton label="Done" fullWidth={false} onPress={() => router.dismiss()} /> }} />
        <Stack.Screen name="preview" options={{ title: 'Preview', headerBackTitle: 'Edit' }} />
        <Stack.Screen name="success" options={{ title: 'Visit shared', headerBackVisible: false }} />
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
  useEffect(() => { if (photos.error) reportError(photos.error, 'visit.share-photos.load'); }, [photos.error]);
  const { controller, draft } = sharing;
  if (!visit.owner.startsWith('account:')) return <GuestVisitSignIn visitId={visit.localId} />;
  if (sharing.profileRequired) return creatingProfile ? <ProfileForm introduction="Create a profile so people can recognize you. You will review this visit before sharing it." onCreated={() => { setCreatingProfile(false); void controller.load(); }} />
    : <VisitPage><Text style={styles.body}>Create a profile to publish this visit.</Text><GalleryButton label="Create profile" variant="filled" onPress={() => setCreatingProfile(true)} /></VisitPage>;
  if (!draft) return <VisitPage><VisitMessage loading={sharing.busy || !sharing.error} action="Try again" onAction={() => { void controller.load(); }}>
    {sharing.error ? 'Sharing could not load.' : 'Preparing sharing…'}
  </VisitMessage><ShareError sharing={sharing} /></VisitPage>;
  const photoWork = visit.works.find((work) => work.localId === photoWorkId);
  if (photoWork) return <SharePhotoPicker work={photoWork} visitId={visit.localId} selected={draft.photoSelections?.find((row) => row.saveLocalId === photoWork.localId)?.photoLocalIds ?? []}
    onDone={() => setPhotoWorkId(undefined)} onChange={(ids) => {
      controller.edit({ photoSelections: [...(draft.photoSelections ?? []).filter((row) => row.saveLocalId !== photoWork.localId), ...(ids.length ? [{ saveLocalId: photoWork.localId, photoLocalIds: ids }] : [])] });
    }} />;
  const selected = new Set(draft.saveLocalIds);
  const highlights = (draft.highlightLocalIds ?? []).filter((id) => selected.has(id));
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
      <Text style={share.step}>1 · Choose what to include</Text>
      <Text style={styles.caption}>{visit.venueName}{'\n'}{formatVisitDate(visit.visitedOn)}</Text>
      {active && <View style={styles.card}>
        <Text style={styles.body}>Public</Text>
        <GalleryButton label="View shared visit" disabled={sharing.busy} onPress={() => router.push({ pathname: '/visit-share/[visitId]/shared', params: { visitId: visit.localId } })} />
      </View>}
      <View style={share.notice}><Text style={styles.fine}>Only the selected photos and your visit notes will be published. Anyone can view a published visit.</Text></View>
      {sharing.acknowledged?.removed ? <Text style={styles.error}>This share is no longer available.</Text> : <>
        <View style={styles.sectionLabel}><Text variant="section">Artworks</Text>
          <Text style={[styles.fine, { color: Gallery.accent }]}>{selected.size} selected</Text></View>
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
            <SavedWorkImage contain path={previewPhotoPath(item.localId)} title={item.title} style={share.thumb} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={share.itemTitle}>{item.title}</Text>
              <Text style={share.itemArtist}>{item.artist || 'Artist unknown'}</Text>
            </View>
            <VisitSymbol name={on ? 'checkmark.circle.fill' : 'circle'} size={22} color={on ? Gallery.accent : Gallery.muted} />
          </Pressable>
        </View>
        <View style={share.itemBottom}>
          <Pressable accessibilityRole="button" accessibilityLabel={`${rank >= 0 ? 'Remove highlight' : 'Highlight'} ${item.title}`}
            accessibilityState={{ selected: rank >= 0, disabled: !on || sharing.busy }} disabled={!on || sharing.busy} onPress={() => toggleHighlight(item.localId)}
            style={[share.highlight, rank >= 0 && share.highlightOn, !on && { opacity: 0.3 }]}>
            <VisitSymbol name={rank >= 0 ? 'star.fill' : 'star'} size={13} color={Gallery.ink} />
            <Text style={share.highlightRank}>{rank >= 0 ? 'Feed highlight' : 'Highlight'}</Text>
          </Pressable>
          <GalleryButton label={`${chosen} of ${total} ${total === 1 ? 'photo' : 'photos'}`} icon="chevron.right" iconPosition="trailing" disabled={!on || sharing.busy}
            onPress={() => setPhotoWorkId(item.localId)} />
        </View>
      </View>;
    }}
    ListFooterComponent={<View style={{ gap: 12, paddingTop: 8 }}>
      <Text variant="section" accessibilityRole="header">Notes</Text>
      {draft.reflection ? <NotePaper><Text selectable style={styles.body}>{draft.reflection}</Text></NotePaper> : <Text style={styles.caption}>No notes added.</Text>}
      <Text style={styles.fine}>Your private artwork notes are not included.</Text>
      <PrivacyNote>Only selected photos from this visit are shared. Artwork notes, wall-label photos, and photos from other visits are not added automatically. Adding a photo later will not share it.</PrivacyNote>
      <GalleryButton label={sharing.conflict ? 'Refresh preview' : 'Preview shared visit'} busy={sharing.busy} busyLabel="Preparing preview…" variant="filled" fullWidth
        disabled={sharing.busy || sharing.acknowledged?.removed} onPress={() => { void preview(); }} />
    </View>} />;
}
export function VisitSharePreviewScreen() {
  const { sharing, visit, setPublished } = useShareFlow();
  const { preview, controller } = sharing;
  const active = sharing.acknowledged?.status === 'active';
  const [publicationError, setPublicationError] = useState<string>();
  const [publishing, setPublishing] = useState(false);
  const submitting = useRef(false);
  if (!preview) return <VisitPage><ShareError sharing={sharing} /><VisitMessage action="Back to selection" onAction={() => router.back()}>Refresh the preview before sharing.</VisitMessage></VisitPage>;
  // Match the published order, with highlights first.
  const highlights = sharing.draft?.highlightLocalIds ?? [];
  const ordered = [...highlights.flatMap((id) => preview.artworks.filter((item) => item.saveLocalId === id)), ...preview.artworks.filter((item) => !highlights.includes(item.saveLocalId))];
  async function publish() {
    if (submitting.current) return;
    submitting.current = true; setPublishing(true); setPublicationError(undefined);
    // The server publishes only Public visits, so a private one is made public for the request and restored if publishing fails.
    const wasPrivate = visit.visibility === 'private';
    try {
      if (wasPrivate) await patchVisit(visit.localId, { visibility: 'public' }, visit.owner);
      if (await controller.publish()) { setPublished(ordered); router.replace({ pathname: '/visit-share/[visitId]/success', params: { visitId: visit.localId } }); return; }
      if (wasPrivate) await patchVisit(visit.localId, { visibility: 'private' }, visit.owner);
    } catch (cause) { reportError(cause, 'visit.publish.visibility'); setPublicationError('Your visit could not be published. Your selection is kept. Try again.'); }
    finally { submitting.current = false; setPublishing(false); }
  }
  return <><GalleryBackToolbar /><VisitPage>
    <Text style={{ alignSelf: 'flex-start', backgroundColor: Gallery.highlight, paddingHorizontal: 6, paddingVertical: 3 }}>2 · Review your visit</Text>
    <VisitFeedCard author={preview.author} venue={preview.venue} visitedOn={preview.visitedOn} notes={preview.reflection}
      artworks={ordered} artworkCount={ordered.length} token={sharing.token} inset={false} />
    <PrivacyNote>Publishing makes these selected photos and visit notes public, including to people without an account. Your other visits and artwork notes stay private.</PrivacyNote>
    <ShareError sharing={sharing} />
    {publicationError && <Text style={styles.error} accessibilityRole="alert">{publicationError}</Text>}
    <GalleryButton label={active ? 'Update shared visit' : 'Publish visit'} busy={publishing || sharing.busy} busyLabel="Sharing…" variant="filled" fullWidth
      disabled={publishing || sharing.busy || sharing.conflict} onPress={() => { void publish(); }} />
    <GalleryButton label="Edit selection" fullWidth disabled={publishing || sharing.busy} onPress={() => router.back()} />
  </VisitPage></>;
}

function CopyVisitLink({ postId }: { postId: string }) {
  const [error, setError] = useState<string>();
  return <><GalleryButton label="Copy link" icon="link" fullWidth onPress={() => {
    setError(undefined);
    void setStringAsync(`artlog://visit/${encodeURIComponent(postId)}`).then((copied) => {
      if (copied) showToast('Visit link copied.'); else setError('Couldn’t copy the link. Try again.');
    }).catch((cause) => { reportError(cause, 'visit.share.copy-link', { level: 'warning' }); setError('Couldn’t copy the link. Try again.'); });
  }} />{error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}</>;
}

export function VisitShareSuccessScreen() {
  const { sharing, visit, published } = useShareFlow();
  const postId = sharing.acknowledged?.postId;
  if (!postId || sharing.acknowledged?.status !== 'active') return <VisitPage><VisitMessage action="Back to selection" onAction={() => router.replace({ pathname: '/visit-share/[visitId]', params: { visitId: visit.localId } })}>This visit hasn’t been shared yet.</VisitMessage></VisitPage>;
  const artworkCount = sharing.acknowledged.saveLocalIds.length;
  return <VisitPage><View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: Gallery.highlight, alignItems: 'center', justifyContent: 'center' }}><VisitSymbol name="checkmark" size={30} color={Gallery.ink} /></View>
    <Text style={styles.caption}>Your {visit.venueName} visit is now public.</Text>
    <View style={{ gap: 10, paddingBottom: 20 }}>
      {!!published?.length && <VisitArtworks artworks={published} token={sharing.token} />}
      <Text style={share.step}>Public</Text><Text variant="section">{visit.venueName}</Text>
      <Text style={styles.caption}>{formatVisitDate(visit.visitedOn)} · {artworkCount} {artworkCount === 1 ? 'artwork' : 'artworks'}</Text>
    </View>
    <GalleryButton label="View shared visit" variant="filled" fullWidth onPress={() => router.replace({ pathname: '/visit-share/[visitId]/shared', params: { visitId: visit.localId } })} />
    {postId && <CopyVisitLink postId={postId} />}
    <GalleryButton label="Done" fullWidth onPress={() => router.dismiss()} />
  </VisitPage>;
}
export function VisitSharedScreen() {
  const { sharing, visit } = useShareFlow();
  const { controller, shared } = sharing;
  const signedIn = visit.owner.startsWith('account:');
  useEffect(() => { if (signedIn) void controller.view(); }, [controller, signedIn]);
  if (!signedIn) return <VisitPage><SocialState title="Sign in to share this visit." detail="You choose what to include before it’s published." icon="person.2"
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
  return <SharedVisitProjection postId={shared.postId}
    author={shared.author} venue={shared.venue} visitedOn={shared.visitedOn} reflection={shared.reflection} token={sharing.token}
    artworks={shared.artworks.page.map((item) => ({ key: item.itemId, title: item.artwork.title, artist: item.artwork.artist, photos: item.photos ?? [] }))}
    footer={<><CopyVisitLink postId={shared.postId} /><ShareError sharing={sharing} /></>} />;
}

const share = StyleSheet.create({
  step: { alignSelf: 'flex-start', backgroundColor: Gallery.highlight, paddingHorizontal: 7, paddingVertical: 5, fontSize: 12, color: Gallery.ink },
  notice: { padding: 14, backgroundColor: '#F0F1E8', borderRadius: 8 },
  item: { marginBottom: 18 },
  itemTop: { paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Gallery.separator },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  thumb: { width: 56, height: 60, backgroundColor: Gallery.fill },
  itemTitle: { fontSize: 16, lineHeight: 22, fontWeight: '600', color: Gallery.ink },
  itemArtist: { fontSize: 13, lineHeight: 18, color: Gallery.muted, marginTop: 2 },
  highlight: { minHeight: 44, paddingHorizontal: 8, flexDirection: 'row', gap: 5, alignItems: 'center', justifyContent: 'center' },
  highlightOn: { backgroundColor: Gallery.highlight, borderRadius: 4 },
  highlightRank: { fontSize: 12, fontWeight: '600', color: Gallery.ink },
  itemBottom: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 6, paddingTop: 8 },
});
