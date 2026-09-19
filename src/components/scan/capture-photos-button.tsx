import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { useLocalOwner } from '@/lib/account/owner-store';
import { readPhotoDraft, updatePhotoSession } from '@/lib/capture/photo-draft';
import type { SaveResultInput } from '@/lib/result/save';
import { canSave } from '@/lib/result/snapshot';
import { GalleryButton } from '../collection/gallery-button';

export function CapturePhotosButton({ input, disabled }: { input: SaveResultInput; disabled?: boolean }) {
  const { label, open, unavailable } = useCapturePhotos(input, disabled);
  return <GalleryButton label={label} icon="photo.badge.plus" disabled={unavailable} onPress={open} />;
}

export function useCapturePhotos(input?: SaveResultInput, disabled = false) {
  const owner = useLocalOwner();
  const path = input?.capture.photoPath;
  const [count, setCount] = useState(0);
  useFocusEffect(useCallback(() => { setCount(path ? readPhotoDraft(owner, path).length : 0); }, [owner, path]));
  return { label: count ? `${count + 1} photos · Add or review` : 'Add photos', unavailable: disabled || !input || !canSave(input.draft), open: () => {
      if (!input || !path) return;
      updatePhotoSession(owner, path, { saveInput: input });
      router.push({ pathname: '/add-photos', params: { draftId: path, title: input.draft.title, objectId: input.view?.primary?.objectId, visitId: input.capture.visitLocalId ?? undefined } });
    } };
}
