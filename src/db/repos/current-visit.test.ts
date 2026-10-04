import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { settings, visits } from "@/db/schema";
import { onCollectionChange } from "@/lib/account/sync-events";

import { activateVisit, visitSettingKeys } from "./current-visit";
import { getSetting, setSetting } from "./settings";
import { getVisit, upsertVisit } from "./visits";

jest.mock("@/db/client", () => ({
  db: jest.requireActual("@/db/test-db").createTestDatabase(),
}));

const owner = "account:me";
const startedAt = Date.parse("2024-02-29T12:00Z");
const previous = {
  localId: "00000000-0000-4000-8000-000000000001",
  venueId: "museum-1" as never,
  venueName: "First museum",
  visitedOn: "2024-02-29",
  timeZone: "UTC",
  startedAt,
};
const next = {
  ...previous,
  localId: "00000000-0000-4000-8000-000000000002",
  venueId: "museum-2" as never,
  venueName: "Second museum",
  startedAt: startedAt + 60_000,
  visibility: "private" as const,
};
const keys = visitSettingKeys(owner);
const endPrevious = { localId: previous.localId, at: next.startedAt };

beforeEach(async () => {
  await db.delete(visits);
  await db.delete(settings);
  await upsertVisit(previous, owner);
  await setSetting(keys.current, previous.localId);
  await setSetting(keys.manual, previous.localId);
  await setSetting(keys.ended, "earlier-visit");
});

it("publishes the ended and new visits only after committing their current-visit settings", async () => {
  const synced = jest.fn(() => {
    expect(db.select().from(visits).all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ localId: previous.localId, endedAt: next.startedAt }),
        expect.objectContaining({ localId: next.localId, endedAt: null }),
      ]),
    );
    expect(db.select().from(settings).all()).toEqual([{ key: keys.current, value: next.localId }]);
  });
  const unsubscribe = onCollectionChange(synced);
  try {
    activateVisit(next, owner, { endPrevious });
    expect(synced).toHaveBeenCalledTimes(1);
    expect(await getVisit(next.localId, owner)).toMatchObject({ visibility: "private" });
  } finally {
    unsubscribe();
  }
});

it("rolls back both visits and their settings when the last write fails", async () => {
  const beforeVisits = db.select().from(visits).all();
  const beforeSettings = db.select().from(settings).all();
  db.run(sql`CREATE TEMP TRIGGER fail_current_visit BEFORE INSERT ON settings
    WHEN NEW.key = 'currentVisit:account:me'
    BEGIN SELECT RAISE(ABORT, 'storage failure'); END`);
  const synced = jest.fn();
  const unsubscribe = onCollectionChange(synced);
  try {
    expect(() => activateVisit(next, owner, { endPrevious })).toThrow("storage failure");
    expect(db.select().from(visits).all()).toEqual(beforeVisits);
    expect(db.select().from(settings).all()).toEqual(beforeSettings);
    expect(synced).not.toHaveBeenCalled();
  } finally {
    db.run(sql`DROP TRIGGER fail_current_visit`);
    unsubscribe();
  }
});

it("preserves a logged visit's details when opening it and records a manual selection", async () => {
  await upsertVisit({ ...next, startedAt: null, reflection: "Keep this", visibility: "friends" }, owner);
  activateVisit(next, owner, { endPrevious, manual: true });
  expect(await getVisit(next.localId, owner)).toMatchObject({
    startedAt: next.startedAt,
    reflection: "Keep this",
    visibility: "friends",
  });
  expect(await getSetting(keys.manual)).toBe(next.localId);
});

it("cannot end another owner's visit or reopen an ended visit", async () => {
  expect(() => activateVisit(next, "account:other", { endPrevious })).toThrow("invalid_visit");
  expect(await getVisit(previous.localId, owner)).toMatchObject({ endedAt: null });
  await upsertVisit({ ...next, endedAt: next.startedAt }, owner);
  expect(() => activateVisit(next, owner, { endPrevious })).toThrow("invalid_visit");
  expect(await getVisit(previous.localId, owner)).toMatchObject({ endedAt: null });
  expect(await getSetting(keys.current)).toBe(previous.localId);
});
