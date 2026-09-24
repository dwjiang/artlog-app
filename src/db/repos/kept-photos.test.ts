import { db } from "../client";
import { artworkPhotos, savedWorks } from "../schema";
import { listKeptPhotos } from "./kept-photos";

jest.mock("../client", () => ({ db: jest.requireActual("../test-db").createTestDatabase() }));

it("finds kept photos across journals, keeps label kinds, and skips deleted works and photos", () => {
  db.insert(savedWorks)
    .values([
      { owner: "device:one", localId: "one", title: "One", artist: "", savedAt: 1, photoPath: "photos/one.jpg" },
      { owner: "account:two", localId: "two", title: "Two", artist: "", savedAt: 1, photoPath: "photos/two.jpg" },
      {
        owner: "device:one",
        localId: "deleted",
        title: "Deleted",
        artist: "",
        savedAt: 1,
        deletedAt: 2,
        photoPath: "photos/deleted.jpg",
      },
    ])
    .run();
  db.insert(artworkPhotos)
    .values([
      {
        owner: "device:one",
        localId: "label",
        savedLocalId: "one",
        kind: "label",
        capturedAt: 1,
        path: "photos/one.jpg",
      },
      {
        owner: "device:one",
        localId: "detail",
        savedLocalId: "one",
        kind: "detail",
        capturedAt: 1,
        path: "artwork-photos/detail.jpg",
      },
      {
        owner: "device:one",
        localId: "removed",
        savedLocalId: "one",
        kind: "full",
        capturedAt: 1,
        path: "artwork-photos/removed.jpg",
        deletedAt: 2,
      },
      {
        owner: "device:one",
        localId: "gone",
        savedLocalId: "deleted",
        kind: "full",
        capturedAt: 1,
        path: "artwork-photos/gone.jpg",
      },
    ])
    .run();
  expect(listKeptPhotos()).toEqual(
    expect.arrayContaining([
      { path: "photos/one.jpg", kind: "label" },
      { path: "photos/two.jpg", kind: "full" },
      { path: "artwork-photos/detail.jpg", kind: "detail" },
    ]),
  );
  expect(listKeptPhotos()).toHaveLength(3);
});
