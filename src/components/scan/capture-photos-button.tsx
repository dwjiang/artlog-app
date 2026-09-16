import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { useLocalOwner } from '@/lib/account/owner-store';
import { readPhotoDraft } from '@/lib/capture/photo-draft';
import { GalleryButton } from '../collection/gallery-button';

export function CapturePhotosButton({ path, title, objectId, visitId, disabled }: { path: string; title?: string; objectId?: string; visitId?: string; disabled?: boolean }) {
  const owner = useLocalOwner();
  const [count, setCount] = useState(0);
  useFocusEffect(useCallback(() => { setCount(readPhotoDraft(owner, path).length); }, [owner, path]));
  return <GalleryButton label={count ? `${count + 1} photos · Add or review` : 'Add photos'} icon="photo.badge.plus" disabled={disabled}
    onPress={() => router.push({ pathname: '/add-photos', params: { draftId: path, title, objectId, visitId } })} />;
}
