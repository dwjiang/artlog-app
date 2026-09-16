import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Image } from 'expo-image';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Gallery } from '@/constants/theme';
import { selectArtworkPhotos } from '@/db/repos/artwork-album';
import type { SavedWork } from '@/db/schema';
import { captureFileUri } from '@/lib/files/photos';
import { GalleryButton } from '../collection/gallery-button';

export function SharePhotoPicker({ work, selected, onChange, onDone }: {
  work: SavedWork; selected: string[]; onChange: (ids: string[]) => void; onDone: () => void;
}) {
  const { data } = useLiveQuery(selectArtworkPhotos(work.localId, work.owner), [work.localId, work.owner]);
  return <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }} style={{ backgroundColor: Gallery.paper }}>
    <GalleryButton label="Done" icon="chevron.left" onPress={onDone} />
    <Text style={{ color: Gallery.ink, fontFamily: 'Georgia', fontSize: 26 }}>{work.title}</Text>
    <Text style={{ color: Gallery.muted, fontSize: 13, lineHeight: 19 }}>Choose the photos your friends can see. New photos stay private until you select them.</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
      {data.filter((row) => row.owner === work.owner).map((photo) => <Pressable key={photo.localId} accessibilityRole="checkbox"
        accessibilityLabel={`Share ${photo.kind} photo${photo.caption ? `: ${photo.caption}` : ''}`} accessibilityState={{ checked: selected.includes(photo.localId) }}
        onPress={() => onChange(selected.includes(photo.localId) ? selected.filter((id) => id !== photo.localId) : [...selected, photo.localId])}
        style={{ width: '47%', borderRadius: 12, overflow: 'hidden', borderWidth: 2, borderColor: selected.includes(photo.localId) ? Gallery.accent : Gallery.fill, backgroundColor: Gallery.fill, padding: 8, gap: 8 }}>
        <Image source={photo.path ? { uri: captureFileUri(photo.path) } : undefined} style={{ width: '100%', height: 155 }} contentFit="contain" />
        <Text style={{ fontSize: 12, color: Gallery.ink }}>{selected.includes(photo.localId) ? '✓ ' : ''}{photo.kind === 'full' ? 'Full view' : photo.kind === 'detail' ? 'Detail' : 'Label'}</Text>
        {!!photo.caption && <Text numberOfLines={2} style={{ color: Gallery.muted, fontSize: 11 }}>{photo.caption}</Text>}
      </Pressable>)}
    </View>
    <Text style={{ color: Gallery.muted, fontSize: 11 }}>{selected.length} selected · Captions and private notes stay private.</Text>
  </ScrollView>;
}
