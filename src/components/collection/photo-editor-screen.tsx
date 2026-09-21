import { EmptyState } from '../empty-state';
import { ThemedText as Text } from '@/components/themed-text';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, TextInput, View } from 'react-native';
import { Gallery } from '@/constants/theme';
import { editArtworkPhoto, selectArtworkPhotos } from '@/db/repos/artwork-album';
import { listSavedWorks } from '@/db/repos/saved-works';
import type { ArtworkPhoto } from '@/db/schema';
import { useLocalOwner } from '@/lib/account/owner-store';
import { captureFileUri } from '@/lib/files/photos';
import { GalleryButton } from './gallery-button';
import { NativeSegmentedPicker } from './native-segmented-picker';
import { PhotoVisibility } from './photo-visibility';
import { ArtworkQueryState } from './artwork-query-state';

export function PhotoEditorScreen() {
  const { savedId, photoId } = useLocalSearchParams<{ savedId: string; photoId: string }>();
  const owner = useLocalOwner();
  const [attempt, setAttempt] = useState(0);
  return <PhotoQuery key={`${owner}:${savedId}:${photoId}:${attempt}`} owner={owner} savedId={savedId} photoId={photoId} onRetry={() => setAttempt((value) => value + 1)} />;
}
function PhotoQuery({ owner, savedId, photoId, onRetry }: { owner: string; savedId: string; photoId: string; onRetry: () => void }) {
  const photos = useLiveQuery(selectArtworkPhotos(savedId, owner), [savedId, owner]);
  const photo = photos.data.find((row) => row.owner === owner && row.savedLocalId === savedId && row.localId === photoId && row.deletedAt === null);
  return photo ? <PhotoEditor key={`${owner}:${photoId}`} photo={photo} />
    : <ArtworkQueryState item="Photo" loading={!photos.updatedAt} error={photos.error} onRetry={onRetry} />;
}
function PhotoEditor({ photo }: { photo: ArtworkPhoto }) {
  const [caption, setCaption] = useState(photo.caption ?? ''), [kind, setKind] = useState(photo.kind), [moving, setMoving] = useState(false);
  const [error, setError] = useState<string>();
  const [captionFocused, setCaptionFocused] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const works = useLiveQuery(listSavedWorks(photo.owner), [photo.owner]);
  const destinations = works.data.filter((work) => work.owner === photo.owner && work.localId !== photo.savedLocalId && work.deletedAt === null);
  const execute = (patch: Parameters<typeof editArtworkPhoto>[1]) => {
    try { editArtworkPhoto(photo.localId, patch, photo.owner); router.back(); }
    catch { setError('Could not update this photo. Please try again.'); }
  };
  return <ScrollView style={{ flex: 1, backgroundColor: Gallery.paper }} contentInsetAdjustmentBehavior="automatic" automaticallyAdjustKeyboardInsets contentContainerStyle={{ padding: 20, gap: 20 }}>
    {photo.path && !imageFailed ? <Image source={{ uri: captureFileUri(photo.path) }} onError={() => setImageFailed(true)} style={{ width: '100%', height: 320, backgroundColor: Gallery.fill }} contentFit="contain" accessibilityLabel="Your artwork photo" />
      : <View style={{ minHeight: 200, justifyContent: 'center', padding: 20, backgroundColor: Gallery.fill }}><Text style={{ color: Gallery.muted }}>{imageFailed ? 'Image unavailable. Your photo details are still here.' : 'Photo unavailable on this iPhone. You can still edit its details.'}</Text></View>}
    {photo.kind !== 'label' && <GalleryButton label="Adjust artwork crop" icon="crop" disabled={!photo.path || imageFailed} onPress={() => router.push({ pathname: '/adjust-crop', params: { savedId: photo.savedLocalId, photoId: photo.localId } })} />}
    <PhotoVisibility savedId={photo.savedLocalId} photoId={photo.localId} />
    <NativeSegmentedPicker label="Photo type" value={kind} options={[{ value: 'full', label: 'Full view' }, { value: 'detail', label: 'Detail' }, { value: 'label', label: 'Label' }]} onChange={setKind} />
    <View style={{ gap: 8 }}><Text style={{ color: Gallery.ink }}>Photo caption</Text>
    <TextInput accessibilityLabel="Photo caption" placeholder="What caught your eye?" placeholderTextColor={Gallery.muted} selectionColor={Gallery.accent} keyboardAppearance="light" onFocus={() => setCaptionFocused(true)} onBlur={() => setCaptionFocused(false)} multiline value={caption} onChangeText={setCaption} maxLength={2000}
      style={{ padding: 16, minHeight: 90, borderRadius: 8, borderWidth: 1, borderColor: captionFocused ? Gallery.accent : Gallery.controlBorder, backgroundColor: Gallery.surface, color: Gallery.ink, fontSize: 17, lineHeight: 25 }} /></View>
    <GalleryButton label="Save photo details" variant="filled" fullWidth onPress={() => execute({ kind, caption })} />
    <GalleryButton label="Move to another artwork" icon="arrow.right" onPress={() => setMoving(!moving)} />
    {moving && <View style={{ gap: 8 }}><Text style={{ color: Gallery.muted }}>Choose the artwork this photo belongs to.</Text>
      {works.error ? <Text accessibilityRole="alert" style={{ color: Gallery.destructive }}>Couldn’t load your artworks. Close and reopen this photo to try again.</Text>
        : !works.updatedAt && !destinations.length ? <Text style={{ color: Gallery.muted }}>Loading artworks…</Text>
        : !destinations.length ? <EmptyState compact title="One artwork so far." detail="Save another artwork before moving this photo. Your photo and edits can stay here."><GalleryButton label="Keep it here" onPress={() => setMoving(false)} /></EmptyState> : null}
      {destinations.map((work) => <GalleryButton key={work.localId} label={work.title} onPress={() => {
        execute({ savedLocalId: work.localId, kind, caption });
      }} />)}</View>}
    <GalleryButton label="Delete photo" icon="trash" destructive onPress={() => Alert.alert('Delete this photo?', 'This removes the photo from your album, wall placements, and shared visits. Your artwork and visits stay.', [
      { text: 'Cancel', style: 'cancel' }, { text: 'Delete photo', style: 'destructive', onPress: () => execute({ deletedAt: Date.now() }) },
    ])} />
    {error && <Text accessibilityRole="alert" style={{ color: Gallery.destructive }}>{error}</Text>}
  </ScrollView>;
}
