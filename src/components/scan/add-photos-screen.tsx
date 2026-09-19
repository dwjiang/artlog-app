import { checkAlbumPhoto } from '@/lib/capture/check-album-photo';
import { getSavedWork, listSavedWorks } from '@/db/repos/saved-works';
import { getPendingScan } from '@/db/repos/pending-scans';
import { getVisit } from '@/db/repos/visits';
import { randomUUID } from 'expo-crypto';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useIsFocused } from 'expo-router/react-navigation';
import { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import { Camera, usePhotoOutput } from 'react-native-vision-camera';
import { ThemedText } from '@/components/themed-text';
import { Gallery } from '@/constants/theme';
import { captureOwner, useLocalOwner } from '@/lib/account/owner-store';
import { extractCaptureMeta } from '@/lib/capture/exif';
import { clearPhotoDraft, readPhotoDraft, readPhotoSession, writePhotoDraft, type DraftPhoto } from '@/lib/capture/photo-draft';
import { captureFileUri, persistArtworkPhoto } from '@/lib/files/photos';
import { removePhotoFile } from '@/lib/account/photo-transfer';
import { saveArtworkSession } from '@/db/repos/artwork-album';
import type { PhotoKind } from '@/shared/collection/album';
import { CaptureContextButton } from './capture-context-button';
import { CaptureCompletion } from './capture-completion';
import type { CaptureCompletion as Completion } from '@/lib/capture/completion';
import { formatVisitDate } from '@/lib/journal/history';
import { saveResult } from '@/lib/result/save';
import { CameraPermission } from './camera-permission';
import { GalleryButton } from '../collection/gallery-button';
import { NativeSegmentedPicker } from '../collection/native-segmented-picker';

const MAX_CHECKS_PER_BATCH = 5;

export function AddPhotosScreen() {
  const params = useLocalSearchParams<{ draftId: string; title?: string; savedId?: string; visitId?: string; objectId?: string }>();
  const owner = useLocalOwner();
  return <PhotoSession key={`${owner}:${params.draftId}`} {...params} owner={owner} />;
}
function PhotoSession({ draftId, title, savedId, visitId, objectId, owner }: { draftId: string; title?: string; savedId?: string; visitId?: string; objectId?: string; owner: string }) {
  const { fontScale } = useWindowDimensions();
  const [photos, setPhotos] = useState(() => readPhotoDraft(owner, draftId));
  const [completion, setCompletion] = useState<Completion>();
  const [kind, setKind] = useState<PhotoKind>('detail');
  const [selected, setSelected] = useState<string | undefined>(() => readPhotoDraft(owner, draftId).find((photo) => photo.review)?.localId ?? '');
  const [removed, setRemoved] = useState<DraftPhoto>();
  const [busy, setBusy] = useState(false), [ready, setReady] = useState(false), [error, setError] = useState<string>();
  const focused = useIsFocused(), busyRef = useRef(false);
  const [appState, setAppState] = useState(AppState.currentState);
  useEffect(() => { const subscription = AppState.addEventListener('change', setAppState); return () => subscription.remove(); }, []);
  // A removed photo stays on disk only while Undo is offered; leaving the screen discards its file.
  const removedRef = useRef<DraftPhoto>(undefined);
  useEffect(() => { removedRef.current = removed; }, [removed]);
  useEffect(() => () => { if (removedRef.current) removePhotoFile(removedRef.current.path); }, []);
  const active = focused && appState === 'active';
  const output = usePhotoOutput({ containerFormat: 'jpeg', quality: 1 });
  const currentPhoto = photos.find((photo) => photo.localId === selected);
  function update(next: DraftPhoto[]) {
    writePhotoDraft(owner, draftId, next); setPhotos(next);
  }
  async function acquire(source: 'camera' | 'library') {
    if (busyRef.current) return;
    busyRef.current = true;
    const session = captureOwner(); setBusy(true); setError(undefined);
    try {
      const sources: { uri: string; capturedAt: number }[] = [];
      if (source === 'camera') {
        const photo = await output.capturePhotoToFile({}, {}); sources.push({ uri: `file://${photo.filePath}`, capturedAt: Date.now() });
      } else {
        const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: Math.max(1, 99 - photos.length), orderedSelection: true, exif: true, quality: 1 });
        if (!result.canceled) sources.push(...result.assets.map((photo) => ({ uri: photo.uri, capturedAt: extractCaptureMeta(photo.exif).capturedAt })));
      }
      const next = [...photos];
      let checks = 0;
      for (const { uri, capturedAt } of sources) {
        if (!session.isOwnerCurrent()) return;
        const localId = randomUUID(), path = await persistArtworkPhoto(uri, localId);
        if (!session.isOwnerCurrent()) return;
        // Each recognition check is a full identify round trip; past the cap, full views wait for the user's confirmation instead.
        const check = kind === 'full' && checks < MAX_CHECKS_PER_BATCH;
        const photo: DraftPhoto = { localId, path, kind, capturedAt, ...(kind === 'full' ? { review: check ? 'checking' : 'uncertain' } : {}) };
        next.push(photo);
        // Persist each photo before asking the camera for another one.
        update([...next]);
        if (check) {
          checks++;
          const target = savedId ? await getSavedWork(savedId, owner) : undefined;
          const result = await checkAlbumPhoto(photo, target?.objectId ?? objectId);
          if (!session.isOwnerCurrent()) return;
          Object.assign(photo, result); update([...next]);
        }
      }
      setSelected(next.find((photo) => photo.review)?.localId);
    } catch { setError('Could not add this photo. Try again.'); }
    finally { busyRef.current = false; setBusy(false); }
  }
  function sessionVisitId() {
    const chosen = readPhotoSession(owner, draftId).visitLocalId;
    return chosen === undefined ? visitId : chosen ?? undefined;
  }
  async function done() {
    if (busyRef.current || completion) return;
    if (photos.some((photo) => photo.review)) { setError('Review the unconfirmed photos before saving.'); return; }
    busyRef.current = true; setBusy(true); setError(undefined);
    const session = captureOwner();
    try {
      if (savedId) {
        if (!photos.length) return;
        const selectedVisitId = sessionVisitId();
        const visit = selectedVisitId ? await getVisit(selectedVisitId, owner) : undefined;
        if (selectedVisitId && !visit) throw new Error('Visit unavailable');
        if (!session.isOwnerCurrent()) return;
        saveArtworkSession(savedId, undefined, photos.map((photo) => ({ ...photo, savedLocalId: savedId, visitLocalId: selectedVisitId })), selectedVisitId, owner);
        clearPhotoDraft(owner, draftId);
        setCompletion({ savedId, title: title || 'Unidentified artwork', wasExisting: true, photoPaths: photos.map((photo) => photo.path),
          visitLabel: visit ? `${visit.venueName} · ${formatVisitDate(visit.visitedOn)}` : 'No visit · Collection only' });
      } else {
        const input = readPhotoSession(owner, draftId).saveInput;
        if (!input) throw new Error('Capture unavailable');
        const capture = await getPendingScan(input.capture.localId, owner);
        if (!capture || !session.isOwnerCurrent()) throw new Error('Capture unavailable');
        const result = await saveResult({ ...input, capture });
        if (session.isOwnerCurrent()) setCompletion(result.completion);
      }
    } catch { setError('Could not save the photos. Your draft is still here.'); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function saveSeparately(photo: DraftPhoto) {
    if (busyRef.current) return;
    busyRef.current = true;
    const session = captureOwner(); setBusy(true);
    try {
      const existing = photo.recognized ? (await listSavedWorks(owner)).find((work) => work.objectId === photo.recognized!.objectId) : undefined;
      const selectedVisitId = sessionVisitId();
      const visit = selectedVisitId ? await getVisit(selectedVisitId, owner) : undefined;
      if (selectedVisitId && !visit) throw new Error('Visit unavailable');
      if (!session.isOwnerCurrent()) return;
      const id = existing?.localId ?? randomUUID();
      saveArtworkSession(id, existing ? undefined : { localId: id, title: photo.recognized?.title ?? 'Unidentified artwork', artist: photo.recognized?.artist ?? '',
        objectId: photo.recognized?.objectId, artworkId: photo.recognized?.artworkId, savedAt: photo.capturedAt, photoPath: photo.path, cropPath: photo.path,
        visitLocalId: visit?.localId, venueId: visit?.venueId, venueName: visit?.venueName }, [{ localId: photo.localId, path: photo.path, kind: photo.kind, capturedAt: photo.capturedAt, savedLocalId: id, visitLocalId: visit?.localId, caption: photo.caption }], visit?.localId, owner);
      update(photos.filter((row) => row.localId !== photo.localId)); setSelected(undefined);
    } catch { setError('Could not save this photo separately. Your draft is still here.'); } finally { busyRef.current = false; setBusy(false); }
  }
  if (completion) return <CaptureCompletion completion={completion} />;
  const photoCount = photos.length + (savedId ? 0 : 1);
  return <ScrollView style={styles.screen} contentContainerStyle={styles.page} contentInsetAdjustmentBehavior="automatic" automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled">
    <Stack.Screen options={{ title: 'Add photos' }} />
    <View style={styles.target}><ThemedText type="smallBold" style={styles.eyebrow}>ADDING PHOTOS TO</ThemedText><ThemedText type="title" style={styles.title}>{title || 'Unidentified artwork'}</ThemedText>
      <ThemedText type="small" style={styles.hint}>Full views, details, and labels stay together.</ThemedText></View>
    <CaptureContextButton draftId={draftId} visitId={visitId} disabled={busy} />
    <View style={styles.camera}>
      {currentPhoto ? <Image source={{ uri: captureFileUri(currentPhoto.path) }} style={StyleSheet.absoluteFill} contentFit="contain" /> : <CameraPermission>
        <Camera style={StyleSheet.absoluteFill} device="back" outputs={[output]} isActive={active} resizeMode="cover" orientationSource="interface"
          onStarted={() => setReady(true)} onStopped={() => setReady(false)} onError={() => setError('Camera unavailable. Add photos from your library.')} />
      </CameraPermission>}
    </View>
    <NativeSegmentedPicker label={currentPhoto ? 'Photo type' : 'Next photo type'} value={currentPhoto?.kind ?? kind} disabled={busy}
      options={[{ value: 'full', label: 'Full view' }, { value: 'detail', label: 'Detail' }, { value: 'label', label: 'Label' }]}
      onChange={(value) => currentPhoto ? update(photos.map((photo) => photo.localId === currentPhoto.localId ? { ...photo, kind: value as PhotoKind } : photo)) : setKind(value as PhotoKind)} />
    {currentPhoto ? <View style={{ gap: 4 }}>
      {!!currentPhoto.review && <View style={{ gap: 8, padding: 16, backgroundColor: Gallery.fill, borderLeftWidth: 3, borderLeftColor: Gallery.warning }}>
        <ThemedText themeColor="warning">{currentPhoto.review === 'checking' && busy ? 'Checking this photo…' : currentPhoto.review === 'conflict' ? `This looks like ${currentPhoto.recognized?.title ?? 'a different artwork'}.` : 'We couldn’t confirm that this is the same artwork.'}</ThemedText>
        <GalleryButton label="Keep with this artwork" disabled={busy} onPress={() => update(photos.map((photo) => photo.localId === currentPhoto.localId ? { ...photo, review: undefined } : photo))} />
        <GalleryButton label="Save as a separate artwork" disabled={busy} onPress={() => { void saveSeparately(currentPhoto); }} />
      </View>}
      <ThemedText type="smallBold">Private caption</ThemedText>
      <TextInput accessibilityLabel="Photo caption" keyboardAppearance="light" selectionColor={Gallery.accent} placeholderTextColor={Gallery.muted} multiline placeholder="Add a private caption" editable={!busy} value={currentPhoto.caption ?? ''} maxLength={2000} style={styles.caption}
        onChangeText={(caption) => update(photos.map((photo) => photo.localId === currentPhoto.localId ? { ...photo, caption } : photo))} />
      <View style={[styles.row, fontScale >= 1.5 && styles.stacked]}><GalleryButton label="Back to camera" disabled={busy} onPress={() => setSelected(undefined)} />
        <GalleryButton label="Remove photo" disabled={busy} destructive onPress={() => {
          if (removed) removePhotoFile(removed.path);
          setRemoved(currentPhoto); update(photos.filter((photo) => photo.localId !== currentPhoto.localId)); setSelected(undefined);
        }} /></View>
    </View> : <View style={[styles.row, fontScale >= 1.5 && styles.stacked]}>
      <GalleryButton label="Library" icon="photo" disabled={busy || photos.length >= 99} onPress={() => { void acquire('library'); }} />
      <Pressable accessibilityRole="button" accessibilityLabel="Take photo" accessibilityState={{ disabled: !ready || busy || photos.length >= 99, busy }} disabled={!ready || busy || photos.length >= 99} onPress={() => { void acquire('camera'); }}
        style={[styles.shutter, (!ready || busy) && { opacity: 0.4 }]}><View style={styles.shutterInner} /></Pressable>
      <ThemedText type="small" style={styles.hint}>{photos.length} new {photos.length === 1 ? 'photo' : 'photos'}</ThemedText>
    </View>}
    <ScrollView horizontal style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 8 }}>
      {photos.map((photo, i) => <Pressable key={photo.localId} accessibilityRole="button" accessibilityLabel={`Review ${photo.kind} photo ${i + 1}`} accessibilityState={{ selected: selected === photo.localId, disabled: busy }} disabled={busy} onPress={() => setSelected(photo.localId)}
        style={[styles.thumb, selected === photo.localId && { borderColor: Gallery.ink, backgroundColor: Gallery.highlight }]}>
        <Image source={{ uri: captureFileUri(photo.path) }} style={{ width: 58, height: 58 }} contentFit="cover" />
        <ThemedText type="small" style={styles.thumbLabel}>{photo.kind}</ThemedText>
      </Pressable>)}
    </ScrollView>
    {photos.length >= 99 && <ThemedText themeColor="warning">Photo limit reached. Remove a photo to add another.</ThemedText>}
    {removed && <GalleryButton label="Photo removed · Undo" disabled={busy} onPress={() => { update([...photos, removed]); setRemoved(undefined); }} />}
    {error && <ThemedText accessibilityRole="alert" style={{ color: Gallery.destructive }}>{error}</ThemedText>}
    <GalleryButton label={`Save ${photoCount} ${photoCount === 1 ? 'photo' : 'photos'}`} variant="filled" fullWidth busy={busy} busyLabel="Saving…" disabled={busy || !photoCount || photos.some((photo) => !!photo.review)} onPress={() => { void done(); }} />
    <ThemedText style={[styles.hint, { textAlign: 'center' }]}>Only you can see these photos.</ThemedText>
  </ScrollView>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Gallery.paper },
  page: { flexGrow: 1, padding: 20, paddingBottom: 30, gap: 12 },
  target: { paddingBottom: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Gallery.separator, gap: 8 },
  eyebrow: { color: Gallery.muted },
  title: { color: Gallery.ink },
  hint: { color: Gallery.muted },
  camera: { width: '100%', aspectRatio: 1, overflow: 'hidden', backgroundColor: Gallery.fill },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  stacked: { flexDirection: 'column', alignItems: 'stretch' },
  shutter: { width: 68, height: 68, borderRadius: 34, borderWidth: 2, borderColor: Gallery.accent, padding: 5 },
  shutterInner: { flex: 1, borderRadius: 30, backgroundColor: Gallery.accent },
  thumb: { borderWidth: 2, borderColor: 'transparent', borderRadius: 2, overflow: 'hidden' },
  thumbLabel: { textAlign: 'center', color: Gallery.ink, paddingVertical: 4 },
  caption: { minHeight: 44, fontSize: 17, lineHeight: 25, backgroundColor: Gallery.surface, borderRadius: 8, borderWidth: 1, borderColor: Gallery.controlBorder, padding: 12, color: Gallery.ink },
});
