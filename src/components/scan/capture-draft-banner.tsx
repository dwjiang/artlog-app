import { and, desc, eq, isNull } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router } from 'expo-router';
import { Alert, Text, View } from 'react-native';
import { Gallery } from '@/constants/theme';
import { db } from '@/db/client';
import { artworkPhotos, pendingScans } from '@/db/schema';
import { deletePendingScan } from '@/db/repos/pending-scans';
import { useLocalOwner } from '@/lib/account/owner-store';
import { clearPhotoDraft, readPhotoDraft } from '@/lib/capture/photo-draft';
import { removePhotoFile } from '@/lib/account/photo-transfer';
import { GalleryButton } from '../collection/gallery-button';

export function CaptureDraftBanner() {
  const owner = useLocalOwner();
  // A saved capture's album row reuses the scan's id (saveResult), so it still marks the scan as saved after its
  // path is cleared or the artwork is deleted; pendingScans rows themselves outlive the save.
  const { data } = useLiveQuery(db.select({ scan: pendingScans }).from(pendingScans).leftJoin(artworkPhotos,
    and(eq(artworkPhotos.owner, pendingScans.owner), eq(artworkPhotos.localId, pendingScans.localId)))
    .where(and(eq(pendingScans.owner, owner), isNull(artworkPhotos.localId))).orderBy(desc(pendingScans.capturedAt)).limit(1), [owner]);
  const draft = data.find(({ scan }) => scan.owner === owner)?.scan;
  if (!draft) return null;
  const extras = readPhotoDraft(owner, draft.photoPath);
  return <View style={{ backgroundColor: Gallery.paper, borderRadius: 12, paddingHorizontal: 12, paddingTop: 8, borderWidth: 0.5, borderColor: Gallery.separator }}>
    <Text style={{ color: Gallery.ink, fontSize: 12 }}>Unsaved artwork · {extras.length + 1} {extras.length ? 'photos' : 'photo'}</Text>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><GalleryButton label="Resume draft" onPress={() => router.push({ pathname: '/result/[scanId]', params: { scanId: draft.scanId ?? `local-${draft.localId}` } })} />
      <GalleryButton label="Discard" onPress={() => Alert.alert('Discard this draft?', 'These unsaved photos will be removed from this device.', [{ text: 'Keep draft', style: 'cancel' }, { text: 'Discard', style: 'destructive', onPress: () => {
        void deletePendingScan(draft.localId, owner).then(async () => {
          clearPhotoDraft(owner, draft.photoPath);
          for (const path of new Set([draft.photoPath, draft.cropPath, ...extras.map((photo) => photo.path)])) await removePhotoFile(path);
        });
      } }])} />
    </View>
  </View>;
}
