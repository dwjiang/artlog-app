import { db } from "@/db/client";
import { savedWorks, visits } from "@/db/schema";

import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { getSavedWork, upsertFromRemote } from "./saved-works";
import { getVisit, moveVisit, upsertVisitsFromRemote } from "./visits";

jest.mock("@/db/client", () => ({
  db: jest.requireActual("@/db/test-db").createTestDatabase(),
}));

const owner = "device:test-installation";
const deviceId = "device" as Id<"devices">;
const visit: Doc<"visits"> = {
  _id: "remote-visit" as Id<"visits">,
  _creationTime: 1,
  owner: { kind: "device", deviceId },
  localId: "ab7f8f54-0af5-4ac0-8839-bc5fc00e3341",
  visibility: "private",
  venueId: "old-museum" as Id<"museums">,
  venueName: "Old Museum",
  visitedOn: "2026-09-01",
  timeZone: "UTC",
  updatedAt: 10,
  updatedBy: deviceId,
  changeVersion: 1,
};
const save: Doc<"collections"> = {
  _id: "remote-work" as Id<"collections">,
  _creationTime: 1,
  owner: visit.owner,
  localId: "ab7f8f54-0af5-4ac0-8839-bc5fc00e3342",
  visitLocalId: visit.localId,
  visitId: visit._id,
  venueId: visit.venueId,
  venueName: visit.venueName,
  savedAt: 1,
  snapshot: { title: "Water Lilies", artist: "Monet" },
  updatedAt: 11,
  updatedBy: deviceId,
  changeVersion: 2,
};

beforeEach(async () => {
  await db.delete(savedWorks);
  await db.delete(visits);
});

it("keeps the moved museum when an older album response follows a newer journal response", async () => {
  await upsertVisitsFromRemote([visit], owner);
  await upsertFromRemote([save], owner);
  const movedVisit = {
    ...visit,
    venueId: "new-museum" as Id<"museums">,
    venueName: "New Museum",
    updatedAt: 20,
    changeVersion: 3,
  };
  const movedSave = {
    ...save,
    venueId: movedVisit.venueId,
    venueName: movedVisit.venueName,
    updatedAt: 21,
    changeVersion: 4,
  };
  await upsertVisitsFromRemote([movedVisit], owner);
  await upsertFromRemote([movedSave], owner);

  await upsertVisitsFromRemote([visit], owner);
  await expect(upsertFromRemote([save], owner)).resolves.toEqual([]);
  expect(await getVisit(visit.localId, owner)).toMatchObject({ venueId: movedVisit.venueId });
  expect(await getSavedWork(save.localId, owner)).toMatchObject({ venueId: movedVisit.venueId, syncedAt: 21 });
});

it("keeps a pending local museum move while merging an older save's newer crop", async () => {
  await upsertVisitsFromRemote([visit], owner);
  await upsertFromRemote([save], owner);
  await moveVisit(
    visit.localId,
    {
      venueId: "new-museum" as Id<"museums">,
      venueName: "New Museum",
      visitedOn: visit.visitedOn,
      timeZone: visit.timeZone,
    },
    owner,
  );

  await upsertVisitsFromRemote([visit], owner);
  await expect(
    upsertFromRemote(
      [
        {
          ...save,
          cropStorageId: "new-crop" as Id<"files">,
          photoUpdatedAt: 30,
        },
      ],
      owner,
    ),
  ).resolves.toEqual([]);
  expect(await getVisit(visit.localId, owner)).toMatchObject({ venueId: "new-museum", syncedAt: null });
  expect(await getSavedWork(save.localId, owner)).toMatchObject({
    venueId: "new-museum",
    venueName: "New Museum",
    cropStorageId: "new-crop",
    photoUpdatedAt: 30,
  });
});
