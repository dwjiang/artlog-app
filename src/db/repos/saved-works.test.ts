import type { NewSavedWork } from "@/db/schema";

import * as repo from "./saved-works";

jest.mock("@/db/client", () => ({
  db: jest.requireActual("@/db/test-db").createTestDatabase(),
}));

function work(localId: string, overrides: Partial<NewSavedWork> = {}): NewSavedWork {
  return {
    localId,
    savedAt: 1,
    title: "Untitled",
    artist: "Unknown",
    cropPath: `crops/${localId}.jpg`,
    photoPath: `photos/${localId}.jpg`,
    ...overrides,
  };
}

beforeAll(async () => {
  await repo.insertSavedWork(
    work("lilies", {
      savedAt: 3,
      title: "Water Lilies",
      artist: "Claude Monet",
      institution: "Musée d'Orsay",
    }),
  );
  await repo.insertSavedWork(
    work("cotton", {
      savedAt: 2,
      title: "100% Cotton",
      artist: "Anon",
      institution: "de Young",
    }),
  );
  await repo.insertSavedWork(work("gone", { savedAt: 1, title: "Deleted", artist: "Monet" }));
  await repo.softDeleteSavedWork("gone", 10);
});

it("lists saved works newest first without deleted rows", async () => {
  expect((await repo.listSavedWorks()).map((entry) => entry.localId)).toEqual(["lilies", "cotton"]);
  expect(await repo.getSavedWork("gone")).toMatchObject({ deletedAt: 10 });
});

it("includes owner-scoped deletions when reconciling the collection wall", async () => {
  await repo.insertSavedWork(work("other-gone"), "account:other");
  await repo.softDeleteSavedWork("other-gone", 20, "account:other");
  expect((await repo.listSavedWorks(undefined, true)).map((entry) => entry.localId)).toEqual([
    "lilies",
    "cotton",
    "gone",
  ]);
});

it("records sync without touching the snapshot", async () => {
  await repo.markSynced([]);
  await repo.markSynced([
    {
      localId: "lilies",
      revision: 0,
      updatedAt: 5,
      updatedBy: "device" as never,
    },
  ]);
  expect(await repo.getSavedWork("lilies")).toMatchObject({
    syncedAt: 5,
    title: "Water Lilies",
    artist: "Claude Monet",
    institution: "Musée d'Orsay",
    deletedAt: null,
  });
  expect((await repo.getSavedWork("cotton"))?.syncedAt).toBeNull();
});
