import { useAuthToken } from "@convex-dev/auth/react";
import { useEffect, useState, useSyncExternalStore } from "react";

import { selectVisitArtworkPhotos } from "@/db/repos/artwork-album";
import { flushCollectionMedia } from "@/lib/account/collection-sync";
import { captureOwner, subscribeOwner } from "@/lib/account/owner-store";

import { createVisitSharingController } from "./visit-sharing-controller";
import { createVisitSharingTransport } from "./visit-sharing-transport";

export function useVisitSharing(visitLocalId: string, saveLocalIds: string[]) {
  const token = useAuthToken();
  const [session] = useState(() => {
    const input = { token, saveLocalIds };
    const controller = createVisitSharingController({
      visitLocalId,
      saveLocalIds: () => input.saveLocalIds,
      transport: createVisitSharingTransport(process.env.EXPO_PUBLIC_CONVEX_URL!),
      capture: () => ({ ...captureOwner(), token: input.token }),
      subscribeOwner,
      flush: () => {
        const { draft } = controller.getSnapshot();
        return flushCollectionMedia({
          saveLocalIds: draft?.saveLocalIds ?? input.saveLocalIds,
          photoLocalIds: draft?.photoSelections?.flatMap((row) => row.photoLocalIds) ?? [],
        });
      },
      photoSelections: () =>
        input.saveLocalIds.flatMap((saveLocalId) => {
          const photos = selectVisitArtworkPhotos(saveLocalId, visitLocalId)
            .all()
            .filter((photo) => photo.kind !== "label");
          return photos.length > 0
            ? [
                {
                  saveLocalId,
                  photoLocalIds: photos.map((photo) => photo.localId),
                },
              ]
            : [];
        }),
    });
    return {
      controller,
      update: (value: typeof input) => {
        input.token = value.token;
        input.saveLocalIds = value.saveLocalIds;
      },
    };
  });
  useEffect(() => {
    session.update({ token, saveLocalIds });
  }, [session, token, saveLocalIds]);
  useEffect(() => {
    session.controller.connect();
    return () => session.controller.dispose();
  }, [session]);
  const state = useSyncExternalStore(
    session.controller.subscribe,
    session.controller.getSnapshot,
    session.controller.getSnapshot,
  );
  return { ...state, controller: session.controller, token };
}
