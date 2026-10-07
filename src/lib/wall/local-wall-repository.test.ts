import { addArtworkPhoto, editArtworkPhoto } from "@/db/repos/artwork-album";
import { insertSavedWork, softDeleteSavedWork } from "@/db/repos/saved-works";
import { switchOwner } from "@/lib/account/owner-store";
import { DEFAULT_WALL_COLOR, STARTER_WALLS } from "@/shared/wall/defaults";

import { createLocalWallRepository } from "./local-wall-repository";

jest.mock("@/db/client", () => ({
  db: jest.requireActual("@/db/test-db").createTestDatabase(),
}));

const layout = { x: 0, y: 0, width: 0.5, layer: 0, frame: "black" as const };
let counter = 0;
function guest() {
  const owner = `device:guest-${++counter}`;
  switchOwner(owner, "guest-scope");
  return owner;
}
function open() {
  const repository = createLocalWallRepository();
  repository.connect();
  return repository;
}

it("starts a signed-out wall empty and keeps saved layouts on this iPhone", async () => {
  guest();
  await insertSavedWork({ localId: "save-a", savedAt: 1, title: "The Milkmaid", artist: "Johannes Vermeer" });
  const first = open();
  await first.refresh();
  const initial = first.getSnapshot().acknowledged!;
  expect(initial.items).toEqual([]);
  expect(STARTER_WALLS).toContainEqual({ color: initial.color, pattern: initial.pattern });
  await first.refresh();
  expect(first.getSnapshot().acknowledged).toEqual(initial);
  const concurrent = open();
  await concurrent.refresh();
  expect(concurrent.getSnapshot().acknowledged).toEqual(initial);
  concurrent.dispose();

  first.setLayoutDraft({
    color: "#6C2F2B",
    pattern: "trellis",
    items: [{ placementId: "placement-a", saveLocalId: "save-a", layout }],
  });
  await first.publishLayout();
  expect(first.getSnapshot()).toMatchObject({ layoutDraft: null, pending: false });
  first.dispose();

  const reopened = open();
  await reopened.refresh();
  expect(reopened.getSnapshot().acknowledged).toEqual({
    color: "#6C2F2B",
    pattern: "trellis",
    items: [{ placementId: "placement-a", saveLocalId: "save-a", layout }],
  });
});

it("drops placements whose artwork or photo the owner no longer has", async () => {
  guest();
  await insertSavedWork({ localId: "kept", savedAt: 1, title: "Kept", artist: "Artist" });
  await insertSavedWork({ localId: "removed", savedAt: 2, title: "Removed", artist: "Artist" });
  await insertSavedWork({ localId: "other", savedAt: 3, title: "Other", artist: "Artist" });
  for (const localId of ["shown", "deleted", "moved"]) {
    addArtworkPhoto({ localId, savedLocalId: "kept", capturedAt: 1, kind: "detail", path: `${localId}.jpg` });
  }
  const repository = open();
  await repository.refresh();
  repository.setLayoutDraft({
    color: DEFAULT_WALL_COLOR,
    items: [
      { placementId: "a", saveLocalId: "kept", layout },
      { placementId: "b", saveLocalId: "removed", layout },
      { placementId: "c", saveLocalId: "kept", photoLocalId: "shown", layout },
      { placementId: "d", saveLocalId: "kept", photoLocalId: "deleted", layout },
      { placementId: "e", saveLocalId: "kept", photoLocalId: "moved", layout },
    ],
  });
  await repository.publishLayout();
  await softDeleteSavedWork("removed");
  editArtworkPhoto("deleted", { deletedAt: 2 });
  editArtworkPhoto("moved", { savedLocalId: "other" });
  await repository.refresh();
  expect(repository.getSnapshot().acknowledged?.items.map((item) => item.placementId)).toEqual(["a", "c"]);
});

it("clears the wall when the owner changes and keeps each owner's wall separate", async () => {
  const first = guest();
  await insertSavedWork({ localId: "save-a", savedAt: 1, title: "Title", artist: "Artist" });
  const repository = open();
  await repository.refresh();
  repository.setLayoutDraft({
    color: "#6C2F2B",
    items: [{ placementId: "a", saveLocalId: "save-a", layout }],
  });
  await repository.publishLayout();

  guest();
  expect(repository.getSnapshot().acknowledged).toBeNull();
  await repository.refresh();
  const other = repository.getSnapshot().acknowledged!;
  expect(other.items).toEqual([]);
  expect(STARTER_WALLS).toContainEqual({ color: other.color, pattern: other.pattern });

  switchOwner(first, "guest-scope");
  await repository.refresh();
  expect(repository.getSnapshot().acknowledged?.color).toBe("#6C2F2B");
});
