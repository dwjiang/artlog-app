import { reportError } from "@/lib/observability";
import { selectAllArtworkPhotos } from "@/db/repos/artwork-album";
import { useAuthToken } from "@convex-dev/auth/react";
import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { useEffect, useState } from "react";
import { Image } from "react-native";
import type { SavedWork } from "@/db/schema";
import { captureOwner, useLocalOwner, useOwnerGeneration, useServerScope } from "../account/owner-store";
import { convexErrorCode } from "../network-error";
import { captureFileUri } from "../files/photos";
import { socialErrorMessage } from "@/shared/social/errors";
import { useWallRepository } from "./use-wall-repository";
import { type WallPiece } from "./wall-layout";
import type { WallTransport } from "./wall-transport";

type Selection = Awaited<ReturnType<WallTransport["listMine"]>>["page"][number] & {
  cropAspectRatio?: number;
};

const LOAD_ERROR = "Your wall could not load. Check your connection and try again.";

function loadFailure(cause: unknown) {
  const profileRequired = convexErrorCode(cause) === "profile_required";
  return {
    profileRequired,
    error: profileRequired ? undefined : (socialErrorMessage(cause) ?? LOAD_ERROR),
  };
}

export function useCollectionWall(works: SavedWork[]) {
  const owner = useLocalOwner();
  const generation = useOwnerGeneration();
  const serverScope = useServerScope();
  const token = useAuthToken();
  const state = useWallRepository();
  const signedIn = owner.startsWith("account:");
  // Identifies the wall read the effect owes for the current account session; unset until the account can be read.
  // A token rotation alone keeps the session valid, so it must not trigger another read.
  const loadKey = signedIn && token && serverScope ? generation : undefined;
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
        }
      })
      .catch((cause: unknown) => {
        if (!active) return;
        reportError(cause, "wall.load");
        const failure = loadFailure(cause);
        setProfileRequired(failure.profileRequired);
        setError(failure.error);
      })
      .finally(() => {
        if (active) setLoadedKey(loadKey);
      });
    return () => {
      active = false;
    };
  }, [loadKey, state.repository]);

  async function refresh() {
    const session = captureOwner();
    setError(undefined);
    setRefreshing(true);
    try {
      await state.repository.refresh();
      if (session.isCurrent()) setProfileRequired(false);
    } catch (cause) {
      if (!session.isCurrent()) return;
      reportError(cause, "wall.load");
      const failure = loadFailure(cause);
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
  const photoPaths = JSON.stringify(
    (draft?.items ?? []).flatMap((item) => {
      const photo = albumPhoto(item.saveLocalId, item.photoLocalId);
      return photo?.path ? [{ id: photo.localId, path: photo.path }] : [];
    }),
  );
  useEffect(() => {
    let active = true;
    void Promise.all(
      (JSON.parse(photoPaths) as { id: string; path: string }[]).map(async ({ id, path }) => {
        try {
          const size = await Image.getSize(captureFileUri(path));
          return [id, size.width / size.height] as const;
        } catch {
          return [id, 1] as const;
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
    const published = state.acknowledged?.items.find((item) => item.placementId === placementId);
    const selection = selections.find((item) => item.localId === saveLocalId);
    const work = works.find((item) => item.localId === saveLocalId);
    const snapshot = selection?.snapshot ?? work;
    if (!published && !snapshot) return [];
    const photo = albumPhoto(saveLocalId, photoLocalId);
    return [
      {
        localId: placementId,
        saveLocalId,
        photoLocalId,
        layout,
        artwork: published?.artwork ?? {
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
        cropPath: photo?.path ?? (!published ? work?.cropPath : undefined),
        cropAspectRatio: photo ? photoAspects[photo.localId] : !published ? selection?.cropAspectRatio : undefined,
      },
    ];
  });

  return {
    ...state,
    signedIn,
    loading: signedIn && (refreshing || (loadKey !== undefined && loadedKey !== loadKey)),
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
