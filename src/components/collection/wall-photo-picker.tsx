import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Image } from 'expo-image';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Gallery } from '@/constants/theme';
import { selectArtworkPhotos } from '@/db/repos/artwork-album';
import { useLocalOwner } from '@/lib/account/owner-store';
import { captureFileUri } from '@/lib/files/photos';

export function WallPhotoPicker({ savedId, selectedId, onSelect }: { savedId: string; selectedId?: string; onSelect: (id: string) => void }) {
  const owner = useLocalOwner();
  const { data } = useLiveQuery(selectArtworkPhotos(savedId, owner), [savedId, owner]);
  return <View style={{ gap: 8, padding: 12 }}><Text style={{ color: Gallery.muted, fontSize: 10, letterSpacing: 1 }}>PHOTO ON THIS FRAME</Text>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>{data.filter((photo) => photo.owner === owner).map((photo, index) => <Pressable key={photo.localId}
      accessibilityRole="button" accessibilityLabel={`Use ${photo.kind} photo ${index + 1} on wall`} accessibilityState={{ selected: photo.localId === selectedId }} onPress={() => onSelect(photo.localId)}
      style={{ width: 56, height: 56, padding: 3, borderWidth: 2, borderColor: photo.localId === selectedId ? Gallery.accent : Gallery.separator, borderRadius: 7 }}>
      {photo.path && <Image source={{ uri: captureFileUri(photo.path) }} style={{ width: '100%', height: '100%' }} contentFit="cover" />}
    </Pressable>)}</ScrollView>
  </View>;
}
