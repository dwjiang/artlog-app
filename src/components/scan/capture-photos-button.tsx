import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";

import { GalleryButton } from "@/components/collection/gallery-button";
import { useLocalOwner } from "@/lib/account/owner-store";
import { readPhotoDraft, updatePhotoSession } from "@/lib/capture/photo-draft";
import type { SaveResultInput } from "@/lib/result/save";
import { canSave } from "@/lib/result/snapshot";

export function CapturePhotosButton({ input, disabled }: { input: SaveResultInput; disabled?: boolean }) {
  const { photoCount, open, unavailable } = useCapturePhotos(input, disabled);
  return (
    <GalleryButton
      label={photoCount > 1 ? `${photoCount} photos · Add or review` : "Add photos"}
      icon="photo.badge.plus"
      disabled={unavailable}
      onPress={open}
    />
  );
}

export function useCapturePhotos(input?: SaveResultInput, disabled = false) {
  const owner = useLocalOwner();
  const path = input?.capture.photoPath;
  const [added, setAdded] = useState(0);
  useFocusEffect(
    useCallback(() => {
      setAdded(path ? readPhotoDraft(owner, path).length : 0);
    }, [owner, path]),
  );
  return {
    photoCount: added + 1,
    unavailable: disabled || !input || !canSave(input.draft),
    open: () => {
      if (!input || !path) return;
      updatePhotoSession(owner, path, { saveInput: input });
      router.push({
        pathname: "/add-photos",
        params: {
          draftId: path,
          title: input.draft.title,
          objectId: input.view?.primary?.objectId,
          visitId: input.capture.visitLocalId ?? undefined,
        },
      });
    },
  };
}
