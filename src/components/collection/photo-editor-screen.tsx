import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';
import { Gallery } from '@/constants/theme';
import { editArtworkPhoto, selectArtworkPhotos } from '@/db/repos/artwork-album';
import { listSavedWorks } from '@/db/repos/saved-works';
import type { ArtworkPhoto } from '@/db/schema';
import { useLocalOwner } from '@/lib/account/owner-store';
import { captureFileUri } from '@/lib/files/photos';
import { GalleryButton } from './gallery-button';
import { NativeSegmentedPicker } from './native-segmented-picker';

export function PhotoEditorScreen() {
  const { savedId, photoId } = useLocalSearchParams<{ savedId: string; photoId: string }>();
  const owner = useLocalOwner();
  const photos = useLiveQuery(selectArtworkPhotos(savedId, owner), [savedId, owner]);
  const photo = photos.data.find((row) => row.owner === owner && row.localId === photoId);
  return photo ? <PhotoEditor key={`${owner}:${photoId}`} photo={photo} /> : <View style={{ flex: 1, backgroundColor: Gallery.paper }} />;
}
function PhotoEditor({ photo }: { photo: ArtworkPhoto }) {
  const [caption, setCaption] = useState(photo.caption ?? ''), [kind, setKind] = useState(photo.kind), [moving, setMoving] = useState(false);
  const [error, setError] = useState<string>();
  const works = useLiveQuery(listSavedWorks(photo.owner), [photo.owner]);
  const execute = (patch: Parameters<typeof editArtworkPhoto>[1]) => {
    try { editArtworkPhoto(photo.localId, patch, photo.owner); router.back(); }
    catch { setError('Could not update this photo. Please try again.'); }
  };
  return <ScrollView style={{ flex: 1, backgroundColor: Gallery.paper }} contentInsetAdjustmentBehavior="automatic" automaticallyAdjustKeyboardInsets contentContainerStyle={{ padding: 20, gap: 20 }}>
    {photo.path && <Image source={{ uri: captureFileUri(photo.path) }} style={{ width: '100%', height: 320, backgroundColor: Gallery.fill, borderRadius: 12 }} contentFit="contain" accessibilityLabel="Your artwork photo" />}
    <Text style={{ color: Gallery.muted, fontSize: 11 }}>PHOTO DETAILS · ONLY YOU</Text>
    <NativeSegmentedPicker label="Photo type" value={kind} options={[{ value: 'full', label: 'Full view' }, { value: 'detail', label: 'Detail' }, { value: 'label', label: 'Label' }]} onChange={setKind} />
    <TextInput accessibilityLabel="Photo caption" placeholder="What caught your eye?" multiline value={caption} onChangeText={setCaption} maxLength={2000}
      style={{ padding: 16, minHeight: 90, borderRadius: 12, backgroundColor: Gallery.fill, color: Gallery.ink, fontSize: 15 }} />
    <GalleryButton label="Save photo details" variant="filled" fullWidth onPress={() => execute({ kind, caption })} />
    <GalleryButton label="Move to another artwork" icon="arrow.right" onPress={() => setMoving(!moving)} />
    {moving && <View style={{ gap: 8 }}><Text style={{ color: Gallery.muted }}>Choose the artwork this photo belongs to.</Text>
      {works.data.filter((work) => work.owner === photo.owner && work.localId !== photo.savedLocalId).map((work) => <GalleryButton key={work.localId} label={work.title} onPress={() => {
        execute({ savedLocalId: work.localId, kind, caption });
      }} />)}</View>}
    <GalleryButton label="Delete photo" icon="trash" destructive onPress={() => Alert.alert('Delete this photo?', 'This removes the photo from your album, wall placements, and shared visits. Your artwork and visits stay.', [
      { text: 'Cancel', style: 'cancel' }, { text: 'Delete photo', style: 'destructive', onPress: () => execute({ deletedAt: Date.now() }) },
    ])} />
    {error && <Text accessibilityRole="alert" style={{ color: Gallery.destructive }}>{error}</Text>}
  </ScrollView>;
}
