import { useAuthToken } from "@convex-dev/auth/react";
import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { useEffect, useState } from "react";
import { Image } from "react-native";

import { selectAllArtworkPhotos } from "@/db/repos/artwork-album";
import type { SavedWork } from "@/db/schema";
import { captureOwner, useLocalOwner, useOwnerGeneration, useServerScope } from "@/lib/account/owner-store";
import { captureFileUri } from "@/lib/files/photos";
import { convexErrorCode } from "@/lib/network-error";
import { reportError } from "@/lib/observability";
import type { JournalSave } from "@/shared/journal/contracts";
import { socialErrorMessage } from "@/shared/social/errors";

import { publishClaimedWall } from "./claimed-wall";
import { useWallRepository } from "./use-wall-repository";
import type { WallDraft, WallPiece } from "./wall-layout";
import type { OwnerWall } from "./wall-transport";

type Selection = Pick<JournalSave, "localId" | "snapshot"> & { cropAspectRatio?: number };

// Only an account's wall is published; a signed-out wall stays on this iPhone.
function isPublished(wall: OwnerWall | WallDraft | null): wall is OwnerWall {
  return !!wall && "profileId" in wall;
}

function loadFailure(cause: unknown, signedIn: boolean) {
  const profileRequired = convexErrorCode(cause) === "profile_required";
  return {
    profileRequired,
    error: profileRequired
      ? undefined
      : signedIn
        ? (socialErrorMessage(cause) ?? "Your wall could not load. Check your connection and try again.")
        : "Your wall could not load. Try again.",
  };
}

export function useCollectionWall(works: SavedWork[]) {
  const owner = useLocalOwner();
  const generation = useOwnerGeneration();
  const serverScope = useServerScope();
  const token = useAuthToken();
  const state = useWallRepository();
  const signedIn = owner.startsWith("account:");
  // Identifies the wall read the effect owes for the current owner session; an account's is unset until it can be read.
  // A token rotation alone keeps the session valid, so it must not trigger another read.
  const loadKey = !signedIn || (token && serverScope) ? generation : undefined;
  const published = isPublished(state.acknowledged) ? state.acknowledged : null;
  const [photoAspects, setPhotoAspects] = useState<Record<string, number>>({});
  const [loadedKey, setLoadedKey] = useState<number>();
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();
  const [profileRequired, setProfileRequired] = useState(false);
  const [selections, setSelections] = useState<Selection[]>([]);
  const [cursor, setCursor] = useState<string | null>();
  const [loadingSelections, setLoadingSelections] = useState(false);

  useEffect(() => {
    if (!loadKey) return;
    let active = true;
    void state.repository
      .refresh()
      .then(() => {
        if (active) {
          setError(undefined);
          setProfileRequired(false);
          void publishClaimedWall(state.repository);
        }
      })
      .catch((cause: unknown) => {
        if (!active) return;
        reportError(cause, "wall.load");
        const failure = loadFailure(cause, signedIn);
        setProfileRequired(failure.profileRequired);
        setError(failure.error);
      })
      .finally(() => {
        if (active) setLoadedKey(loadKey);
      });
    return () => {
      active = false;
    };
  }, [loadKey, signedIn, state.repository]);

  async function refresh() {
    const session = captureOwner();
    setError(undefined);
    setRefreshing(true);
    try {
      await state.repository.refresh();
      if (session.isCurrent()) {
        setProfileRequired(false);
        void publishClaimedWall(state.repository);
      }
    } catch (cause) {
      if (!session.isCurrent()) return;
      reportError(cause, "wall.load");
      const failure = loadFailure(cause, signedIn);
      setProfileRequired(failure.profileRequired);
      setError(failure.error);
    } finally {
      if (session.isCurrent()) setRefreshing(false);
    }
  }

  const draft =
    state.layoutDraft
    ?? (state.acknowledged
      ? {
          color: state.acknowledged.color,
          pattern: state.acknowledged.pattern,
          items: state.acknowledged.items.map(({ placementId, photoLocalId, saveLocalId, layout }) => ({
            placementId,
            photoLocalId,
            saveLocalId,
            layout,
          })),
        }
      : null);

  async function loadSelections(reset = false) {
    if (loadingSelections || (!reset && cursor === null)) return;
    const session = captureOwner();
    const from = reset ? undefined : cursor;
    setLoadingSelections(true);
    setError(undefined);
    if (reset) setCursor(undefined);
    try {
      const result = await state.repository.listSelections(from);
      const page: Selection[] = await Promise.all(
        result.page.map(async (item) => {
          const path = works.find((work) => work.localId === item.localId)?.cropPath;
          if (!path) return item;
          try {
            const { width, height } = await Image.getSize(captureFileUri(path));
            return {
              ...item,
              cropAspectRatio: width > 0 && height > 0 ? width / height : undefined,
            };
          } catch {
            return item;
          }
        }),
      );
      if (!session.isCurrent()) return;
      // Hung selections supply the draft's snapshots, so a reset keeps them and replaces the rest.
      const hung = new Set(draft?.items.map((item) => item.saveLocalId));
      setSelections((previous) => {
        const kept = reset ? previous.filter((item) => hung.has(item.localId)) : previous;
        return [...kept, ...page.filter((item) => !kept.some((old) => old.localId === item.localId))];
      });
      setCursor(result.isDone ? null : result.cursor);
    } catch (cause) {
      if (session.isCurrent()) reportError(cause, "wall.selections.load");
      if (session.isCurrent()) {
        setError(socialErrorMessage(cause) ?? "Artworks could not load. Try again.");
      }
    } finally {
      if (session.isCurrent()) setLoadingSelections(false);
    }
  }

  const albumPhotos = useLiveQuery(selectAllArtworkPhotos(owner), [owner]);
  useEffect(() => {
    if (albumPhotos.error) reportError(albumPhotos.error, "wall.photos.load");
  }, [albumPhotos.error]);
  const albumPhoto = (saveLocalId: string, photoLocalId?: string) =>
    photoLocalId
      ? albumPhotos.data.find(
          (row) => row.owner === owner && row.savedLocalId === saveLocalId && row.localId === photoLocalId,
        )
      : undefined;
  const wallPhotoPath = (saveLocalId: string, photoLocalId?: string) => {
    const work = works.find((row) => row.owner === owner && row.localId === saveLocalId);
    const photo = albumPhoto(saveLocalId, photoLocalId);
    if (work?.cropPath && (!photoLocalId || photoLocalId === work.cropPhotoLocalId)) return work.cropPath;
    return photo?.path;
  };
  const photoPaths = JSON.stringify(
    (draft?.items ?? []).flatMap((item) => {
      const path = wallPhotoPath(item.saveLocalId, item.photoLocalId);
      return path ? [path] : [];
    }),
  );
  useEffect(() => {
    let active = true;
    void Promise.all(
      [...new Set(JSON.parse(photoPaths) as string[])].map(async (path) => {
        try {
          const size = await Image.getSize(captureFileUri(path));
          return [path, size.width / size.height] as const;
        } catch {
          return [path, 1] as const;
        }
      }),
    ).then((entries) => {
      if (active) setPhotoAspects(Object.fromEntries(entries));
    });
    return () => {
      active = false;
    };
  }, [photoPaths]);

  const pieces: WallPiece[] = (draft?.items ?? []).flatMap(({ placementId, photoLocalId, saveLocalId, layout }) => {
    const publishedItem = published?.items.find((item) => item.placementId === placementId);
    const selection = selections.find((item) => item.localId === saveLocalId);
    const work = works.find((item) => item.localId === saveLocalId);
    const snapshot = selection?.snapshot ?? work;
    if (!publishedItem && !snapshot) return [];
    const path = wallPhotoPath(saveLocalId, photoLocalId);
    return [
      {
        localId: placementId,
        saveLocalId,
        photoLocalId,
        layout,
        artwork: publishedItem?.artwork ?? {
          title: snapshot!.title,
          artist: snapshot!.artist,
          date: snapshot!.date ?? undefined,
          medium: snapshot!.medium ?? undefined,
          media: {
            kind: "placeholder" as const,
            width: 1 as const,
            height: 1 as const,
          },
        },
        cropPath: path,
        cropAspectRatio: path ? photoAspects[path] : !publishedItem ? selection?.cropAspectRatio : undefined,
      },
    ];
  });

  return {
    ...state,
    acknowledged: published,
    signedIn,
    loading: refreshing || (loadKey !== undefined && loadedKey !== loadKey),
    error,
    setError,
    profileRequired,
    refresh,
    selections,
    cursor,
    loadingSelections,
    loadSelections,
    draft,
    pieces,
  };
}
