import { db } from "@/db/client";
import * as saves from "@/db/repos/saved-works";
import * as visits from "@/db/repos/visits";
import { pendingScans, savedWorks, visits as visitTable } from "@/db/schema";

import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { getLocalOwner } from "./owner-store";
import { syncJournal, type SyncContext, type SyncDependencies } from "./sync";

jest.mock("@/db/client", () => ({
  db: jest.requireActual("@/db/test-db").createTestDatabase(),
}));
const context: SyncContext = {
  scope: "scope",
  owner: getLocalOwner(),
  deviceId: "a" as Id<"devices">,
  accountId: null,
};
const remoteVisit: Doc<"visits"> = {
  visibility: "public" as const,
  _id: "visit" as never,
  _creationTime: 1,
  owner: { kind: "device", deviceId: context.deviceId },
  localId: "bece7508-7d6f-56b8-82ea-f78d7ddf19de",
  venueId: "museum" as never,
  venueName: "Museum",
  visitedOn: "2026-09-01",
  timeZone: "UTC",
  updatedAt: 2,
  updatedBy: context.deviceId,
  changeVersion: 1,
};
const remote: Doc<"collections"> = {
  _id: "remote-1" as Id<"collections">,
  _creationTime: 1,
  owner: remoteVisit.owner,
  changeVersion: 2,
  localId: "remote-work",
  visitId: remoteVisit._id,
  visitLocalId: remoteVisit.localId,
  venueId: remoteVisit.venueId,
  snapshot: { title: "Remote work", artist: "Artist" },
  savedAt: 1,
  updatedAt: 2,
  updatedBy: context.deviceId,
};
let checkpoint: string | undefined;
let deps: SyncDependencies;
const api = jest.fn<ReturnType<SyncDependencies["sync"]>, Parameters<SyncDependencies["sync"]>>();
const empty = {
  venues: [],
  acceptedVisits: [],
  acceptedSaves: [],
  visits: [],
  saves: [],
  checkpoint: 20,
  hasMore: false,
};
beforeEach(async () => {
  await db.delete(savedWorks);
  await db.delete(pendingScans);
  await db.delete(visitTable);
  checkpoint = undefined;
  api.mockReset();
  deps = {
    ...saves,
    ...visits,
    applyVenues: jest.fn().mockResolvedValue(undefined),
    getCheckpoint: async () => checkpoint,
    setCheckpoint: async (value) => {
      checkpoint = value;
    },
    sync: api,
    removeUnreferencedPhotos: jest.fn().mockResolvedValue(undefined),
  };
  api.mockImplementation(async (args) => ({
    ...empty,
    acceptedVisits: args.visits.map(({ localId }) => ({
      localId,
      visitId: "visit" as never,
      updatedAt: 20,
      updatedBy: context.deviceId,
    })),
    acceptedSaves: args.saves.map(({ localId }) => ({
      localId,
      updatedAt: 20,
      updatedBy: context.deviceId,
    })),
  }));
});

it("pushes scoped snapshots, applies parents before saves, acknowledges and checkpoints", async () => {
  await saves.insertSavedWork({
    localId: "local",
    title: "Local",
    artist: "",
    savedAt: 1,
    photoPath: "photo.jpg",
  });
  api.mockResolvedValueOnce({
    ...empty,
    acceptedSaves: [{ localId: "local", updatedAt: 20, updatedBy: context.deviceId }],
    visits: [remoteVisit],
    saves: [remote],
  });
  await syncJournal(deps, context);
  expect(api.mock.calls[0][0].saves[0]).toMatchObject({
    localId: "local",
    snapshot: { title: "Local" },
  });
  expect(api.mock.calls[0][0].saves[0]).not.toHaveProperty("photoPath");
  expect(await saves.listUnsynced()).toEqual([]);
  expect(await saves.getSavedWork(remote.localId)).toMatchObject({
    visitLocalId: remoteVisit.localId,
  });
  expect(checkpoint).toBe("20");
});

it("leaves edits pending and checkpoints unchanged on network or local-write failures", async () => {
  await saves.insertSavedWork({
    localId: "local",
    title: "Local",
    artist: "",
    savedAt: 1,
  });
  api.mockRejectedValueOnce(new Error("offline"));
  await expect(syncJournal(deps, context)).rejects.toThrow("offline");
  expect(await saves.listUnsynced()).toHaveLength(1);
  expect(checkpoint).toBeUndefined();
  api.mockResolvedValueOnce({
    ...empty,
    visits: [remoteVisit],
    saves: [remote],
  });
  deps.upsertVisitsFromRemote = async () => {
    throw new Error("SQLITE_BUSY");
  };
  await expect(syncJournal(deps, context)).rejects.toThrow("SQLITE_BUSY");
  expect(checkpoint).toBeUndefined();
});

it("resumes at the last applied change after an interrupted pull", async () => {
  api
    .mockResolvedValueOnce({
      ...empty,
      visits: [remoteVisit],
      checkpoint: 1,
      hasMore: true,
    })
    .mockRejectedValueOnce(new Error("offline"));
  await expect(syncJournal(deps, context)).rejects.toThrow("offline");
  expect(checkpoint).toBe("1");
  await syncJournal(deps, context);
  expect(api.mock.calls[2][0].since).toBe(1);
});

it("applies a remote discard despite a local edit made while sync is in flight", async () => {
  await visits.upsertVisitsFromRemote([remoteVisit]);
  checkpoint = "1";
  api.mockImplementationOnce(async () => {
    await visits.patchVisit(remoteVisit.localId, { reflection: "Edited during sync" });
    return {
      ...empty,
      visits: [{ ...remoteVisit, deletedAt: 3, updatedAt: 4, changeVersion: 2 }],
      checkpoint: 2,
    };
  });
  await syncJournal(deps, context);
  expect(await visits.listVisits()).toEqual([]);
  expect(await visits.getVisit(remoteVisit.localId, undefined, { discarded: true })).toMatchObject({
    deletedAt: 3,
    reflection: null,
    syncedAt: 4,
  });
  expect(await visits.listUnsyncedVisits()).toEqual([]);
  await syncJournal(deps, context);
  expect(await visits.listVisits()).toEqual([]);
});

it("keeps a local discard when an older live visit arrives after its acknowledgement", async () => {
  await visits.upsertVisitsFromRemote([remoteVisit]);
  visits.discardVisit(remoteVisit.localId, context.owner, 3);
  api.mockResolvedValueOnce({
    ...empty,
    acceptedVisits: [
      { localId: remoteVisit.localId, visitId: remoteVisit._id, updatedAt: 4, updatedBy: context.deviceId },
    ],
    visits: [{ ...remoteVisit, reflection: "Before discard" }],
  });
  await syncJournal(deps, context);
  expect(await visits.listVisits()).toEqual([]);
  expect(await visits.getVisit(remoteVisit.localId, undefined, { discarded: true })).toMatchObject({
    deletedAt: 3,
    reflection: null,
  });
});

it("discards in-flight responses after account changes", async () => {
  let active = true;
  api.mockImplementationOnce(async () => {
    active = false;
    return { ...empty, visits: [remoteVisit], saves: [remote] };
  });
  await syncJournal(deps, context, () => active);
  expect(await saves.listSavedWorks()).toEqual([]);
  expect(await visits.listVisits()).toEqual([]);
  expect(checkpoint).toBeUndefined();
});

it("sends empty visits before save batches and leaves hidden account work suspended", async () => {
  await visits.upsertVisit({
    visibility: "public" as const,
    localId: "82c19918-521d-5d4c-a310-5c5a6b02f7d1",
    venueId: "museum" as never,
    venueName: "Museum",
    visitedOn: "2026-09-01",
    timeZone: "UTC",
  });
  await db.insert(savedWorks).values(
    Array.from({ length: 70 }, (_, i) => ({
      owner: context.owner,
      localId: `local-${i}`,
      title: "Painting",
      artist: "",
      savedAt: i,
    })),
  );
  await saves.insertSavedWork({ localId: "hidden", title: "Hidden", artist: "", savedAt: 0 }, "account:hidden");
  await syncJournal(deps, context);
  expect(api.mock.calls.map(([args]) => args.visits.length + args.saves.length)).toEqual([50, 21]);
  expect(api.mock.calls[0][0].visits).toHaveLength(1);
  expect(await saves.listUnsynced()).toEqual([]);
  expect(await saves.listUnsynced("account:hidden")).toHaveLength(1);
});

it("applies canonical venue metadata before advancing the checkpoint", async () => {
  const venues = [
    {
      id: remoteVisit.venueId,
      key: "poi:canonical",
      region: "US",
      name: "Museum",
      lat: 1,
      lng: 2,
      city: "New York",
      country: "US",
      cityKey: "wikidata:Q60",
    },
  ];
  api.mockResolvedValueOnce({ ...empty, visits: [remoteVisit], venues });
  await syncJournal(deps, context);
  expect(deps.applyVenues).toHaveBeenCalledWith(venues);
  expect(checkpoint).toBe("20");
  checkpoint = undefined;
  api.mockResolvedValueOnce({ ...empty, venues });
  deps.applyVenues = async () => {
    throw new Error("SQLITE_BUSY");
  };
  await expect(syncJournal(deps, context)).rejects.toThrow("SQLITE_BUSY");
  expect(checkpoint).toBeUndefined();
});

it("rejects remote rows belonging to a different owner before applying data", async () => {
  api.mockResolvedValueOnce({
    ...empty,
    visits: [
      {
        ...remoteVisit,
        owner: { kind: "account", accountId: "foreign" as never },
      },
    ],
  });
  await expect(syncJournal(deps, context)).rejects.toThrow("not_found");
  expect(await visits.listVisits()).toEqual([]);
  expect(checkpoint).toBeUndefined();
});

it("removes the local crop file a newer remote crop displaced", async () => {
  await saves.insertSavedWork({
    localId: remote.localId,
    title: "Local",
    artist: "",
    savedAt: 1,
    cropPath: "crops/old.preview.jpg",
    cropStorageId: "old" as Id<"files">,
    syncedAt: 1,
  });
  api.mockResolvedValueOnce({
    ...empty,
    visits: [remoteVisit],
    saves: [{ ...remote, cropStorageId: "new" as Id<"files">, photoUpdatedAt: 5 }],
  });
  await syncJournal(deps, context);
  expect(deps.removeUnreferencedPhotos).toHaveBeenCalledWith(["crops/old.preview.jpg"]);
  expect(await saves.getSavedWork(remote.localId)).toMatchObject({
    cropPath: null,
    cropStorageId: "new" as Id<"files">,
  });
});
