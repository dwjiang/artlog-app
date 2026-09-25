import { selectAllArtworkPhotos } from "@/db/repos/artwork-album";
import { listSavedWorks } from "@/db/repos/saved-works";
import { getSetting, setSetting } from "@/db/repos/settings";
import { captureOwner, subscribeOwnerChange } from "@/lib/account/owner-store";
import { DEFAULT_WALL_COLOR } from "@/shared/wall/defaults";

import type { WallDraft } from "./wall-layout";
import type { WallState } from "./wall-repository";

export const privateWallKey = (owner: string) => `wall:${owner}`;

/** The stored private wall, dropping placements whose artwork or photo is gone as the public wall does. */
export async function readPrivateWall(owner: string): Promise<WallDraft | undefined> {
  const stored = await getSetting(privateWallKey(owner));
  if (!stored) return;
  const wall = JSON.parse(stored) as WallDraft;
  const saved = new Set(
    listSavedWorks(owner)
      .all()
      .map((work) => work.localId),
  );
  const photos = new Set(
    selectAllArtworkPhotos(owner)
      .all()
      .map((photo) => `${photo.savedLocalId}:${photo.localId}`),
  );
  return {
    color: wall.color,
    pattern: wall.pattern,
    items: wall.items.filter(
      (item) =>
        saved.has(item.saveLocalId) && (!item.photoLocalId || photos.has(`${item.saveLocalId}:${item.photoLocalId}`)),
    ),
  };
}

const empty = (): WallState<WallDraft> => ({
  acknowledged: null,
  layoutDraft: null,
  noteDraft: [],
  pending: false,
});

/** A signed-out owner's wall: kept private on this iPhone until a sign-in claims it for the account's public wall. */
export function createLocalWallRepository() {
  let state = empty();
  let generation = 0;
  let unsubscribe: (() => void) | undefined;
  const listeners = new Set<() => void>();
  function update(patch: Partial<WallState<WallDraft>>) {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  }
  function clear() {
    generation++;
    state = empty();
    for (const listener of listeners) listener();
  }
  function session() {
    const owner = captureOwner();
    const version = generation;
    const active = () => version === generation && owner.isOwnerCurrent();
    return {
      owner: owner.owner,
      active,
      check: () => {
        if (!active()) throw new Error("Wall request cancelled");
      },
    };
  }
  async function refresh() {
    if (state.pending) throw new Error("A wall update is in progress");
    const current = session();
    const wall = await readPrivateWall(current.owner);
    current.check();
    update({ acknowledged: wall ?? { color: DEFAULT_WALL_COLOR, items: [] } });
  }
  async function publishLayout() {
    if (state.pending) throw new Error("A wall update is in progress");
    if (!state.acknowledged) throw new Error("Refresh your wall first");
    const { layoutDraft } = state;
    if (!layoutDraft) return;
    const current = session();
    update({ pending: true });
    try {
      await setSetting(privateWallKey(current.owner), JSON.stringify(layoutDraft));
      current.check();
      update({
        acknowledged: layoutDraft,
        ...(state.layoutDraft === layoutDraft ? { layoutDraft: null } : {}),
      });
    } finally {
      if (current.active()) update({ pending: false });
    }
  }
  function unpublished(): never {
    throw new Error("Sign in to share notes on a public wall");
  }
  return {
    connect: () => {
      unsubscribe ??= subscribeOwnerChange(clear);
    },
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh,
    setLayoutDraft: (draft: WallDraft) => {
      if (!state.acknowledged) throw new Error("Refresh your wall first");
      update({
        layoutDraft: {
          color: draft.color,
          pattern: draft.pattern,
          items: draft.items.map((item) => ({
            placementId: item.placementId,
            saveLocalId: item.saveLocalId,
            photoLocalId: item.photoLocalId,
            layout: { ...item.layout },
          })),
        },
      });
    },
    setNoteDraft: (_changes: unknown) => unpublished(),
    publishLayout,
    publishNotes: async () => unpublished(),
    listSelections: async (_cursor?: string | null) => {
      const current = session();
      const page = listSavedWorks(current.owner)
        .all()
        .map((work) => ({
          localId: work.localId,
          snapshot: {
            title: work.title,
            artist: work.artist,
            ...(work.date ? { date: work.date } : {}),
            ...(work.medium ? { medium: work.medium } : {}),
            ...(work.institution ? { institution: work.institution } : {}),
          },
        }));
      current.check();
      return { page, cursor: null, isDone: true };
    },
    discardDrafts: () => update({ layoutDraft: null }),
    dispose: () => {
      unsubscribe?.();
      unsubscribe = undefined;
      clear();
    },
  };
}
