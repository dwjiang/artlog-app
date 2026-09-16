import { Text, View } from 'react-native';
import { useLocalOwner } from '@/lib/account/owner-store';
import { commitRemoval, undoRemoval, usePendingRemovals } from '@/lib/collection/pending-removals';
import { Gallery } from '@/constants/theme';
import { GalleryButton } from './gallery-button';

export function RemovalToast() {
  const owner = useLocalOwner();
  const pending = usePendingRemovals().filter((item) => item.owner === owner);
  if (!pending.length) return null;
  return <View style={{ position: 'absolute', bottom: 100, left: 18, right: 18, gap: 8 }}>
    {pending.map((item) => <View key={item.localId} style={{ backgroundColor: Gallery.surface, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 8, boxShadow: '0 3px 20px #0002', flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <Text accessibilityRole="alert" style={{ flex: 1, fontSize: 13, color: Gallery.ink }}>{item.status === 'failed' ? `Couldn’t remove ${item.title}.` : item.status === 'saving' ? 'Removing artwork…' : 'Artwork removed from collection.'}</Text>
      {item.status === 'failed' && <GalleryButton label="Retry" onPress={() => { void commitRemoval(item); }} />}
      {item.status !== 'saving' && <GalleryButton label="Undo" onPress={() => undoRemoval(item)} />}
    </View>)}
  </View>;
}
