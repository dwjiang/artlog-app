import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { useLocalOwner } from '@/lib/account/owner-store';
import { readPhotoDraft, updatePhotoSession } from '@/lib/capture/photo-draft';
import type { SaveResultInput } from '@/lib/result/save';
import { canSave } from '@/lib/result/snapshot';
import { GalleryButton } from '../collection/gallery-button';

export function CapturePhotosButton({ input, disabled }: { input: SaveResultInput; disabled?: boolean }) {
  const owner = useLocalOwner();
  const path = input.capture.photoPath;
  const [count, setCount] = useState(0);
  useFocusEffect(useCallback(() => { setCount(readPhotoDraft(owner, path).length); }, [owner, path]));
  return <GalleryButton label={count ? `${count + 1} photos · Add or review` : 'Add photos'} icon="photo.badge.plus" disabled={disabled || !canSave(input.draft)}
    onPress={() => {
      updatePhotoSession(owner, path, { saveInput: input });
      router.push({ pathname: '/add-photos', params: { draftId: path, title: input.draft.title, objectId: input.view?.primary?.objectId, visitId: input.capture.visitLocalId ?? undefined } });
    }} />;
}
