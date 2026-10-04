import { expect, it, vi } from "vitest";

import { STARTER_WALLS } from "../shared/wall/defaults";
import { WALL_FRAMES } from "../shared/wall/frames";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { fileStorage } from "./lib/fileStorage";
import { upsertJournalSave } from "./lib/journal";
import { resetNoteSharing } from "./lib/publicationAccess";
import { befriend, setVisitVisibility, socialUser, socialVisit } from "./lib/socialTestFixtures";
import { seedArtworkWithObject, seedDevice } from "./lib/testFactories";
import { wallFixture } from "./lib/wallFixtures";
import { type Harness, harness } from "./test.helpers";

async function syncNote(t: Harness, a: Awaited<ReturnType<typeof wallFixture>>, note: string) {
  await t.run(async (ctx) => {
    const save = (await ctx.db.get("collections", a.saveId))!;
    await upsertJournalSave(ctx, save.owner, a.deviceId, {
      localId: save.localId,
      savedAt: save.savedAt,
      snapshot: save.snapshot,
      note,
    });
  });
}

it("updates the starter wall, normalizes color and acknowledges unchanged retries", async () => {
  const t = harness();
  const a = await wallFixture(t, "a");
  const initial = await a.as.query(api.walls.getMine, {});
  expect(initial).toMatchObject({ revision: 0, items: [] });
  expect(STARTER_WALLS).toContainEqual({ color: initial.color, pattern: initial.pattern });
  expect(await t.query(api.walls.getPublic, { profileId: a.profile.profileId })).toMatchObject({
    color: initial.color,
    pattern: initial.pattern,
    items: [],
  });
  expect(await t.run((ctx) => ctx.db.query("walls").collect())).toHaveLength(1);
  const results = await Promise.all(
    [1, 2].map(() => a.as.mutation(api.walls.setLayout, { ...a.input, color: "#abcdef" })),
  );
  expect(results[0]).toEqual(results[1]);
  expect(results[0]).toMatchObject({
    revision: 1,
    color: "#ABCDEF",
    items: [
      {
        placementId: a.input.items[0].placementId,
        saveLocalId: a.saveLocalId,
        noteVisible: false,
        noteRevision: 0,
      },
    ],
  });
  expect(await t.run((ctx) => ctx.db.query("walls").collect())).toHaveLength(1);
  expect(await t.query(api.profiles.getPublic, { profileId: a.profile.profileId })).toMatchObject({
    publishedWallCount: 1,
  });
  await expect(a.as.mutation(api.walls.setLayout, { ...a.input, color: "#123456" })).rejects.toMatchObject({
    data: { code: "conflict" },
  });
});

it("preserves an existing wall color, frame, photo choice and geometry on reads", async () => {
  const t = harness();
  const a = await wallFixture(t, "custom");
  const customized = await a.as.mutation(api.walls.setLayout, {
    ...a.input,
    color: "#45524B",
    items: [{ ...a.selection, layout: { ...a.layout, frame: "walnut" } }],
  });
  expect(await a.as.query(api.walls.getMine, {})).toEqual(customized);
  expect(await t.query(api.walls.getPublic, { profileId: a.profile.profileId })).toMatchObject({
    color: "#45524B",
    items: [{ layout: { ...a.layout, frame: "walnut" } }],
  });
});

it("saves a wallpaper pattern with the color, shares it publicly and clears it back to plain", async () => {
  const t = harness();
  const a = await wallFixture(t, "pattern");
  const striped = await a.as.mutation(api.walls.setLayout, { ...a.input, pattern: "stripe" });
  expect(striped).toMatchObject({ revision: 1, color: "#45524B", pattern: "stripe" });
  expect(await a.as.mutation(api.walls.setLayout, { ...a.input, pattern: "stripe" })).toEqual(striped);
  expect(await t.query(api.walls.getPublic, { profileId: a.profile.profileId })).toMatchObject({
    color: "#45524B",
    pattern: "stripe",
  });
  await expect(a.as.mutation(api.walls.setLayout, { ...a.input, pattern: "dots" })).rejects.toMatchObject({
    data: { code: "conflict" },
  });
  await expect(
    a.as.mutation(api.walls.setLayout, { ...a.input, revision: 1, pattern: "plaid" as "stripe" }),
  ).rejects.toThrow("Validator error");

  const plain = await a.as.mutation(api.walls.setLayout, { ...a.input, revision: 1 });
  expect(plain.revision).toBe(2);
  expect(plain).not.toHaveProperty("pattern");
  expect(await t.query(api.walls.getPublic, { profileId: a.profile.profileId })).not.toHaveProperty("pattern");
});

it("requires a linked profile, completed claim and current owner scope", async () => {
  const t = harness();
  const a = await wallFixture(t, "a");
  const b = await wallFixture(t, "b");
  const anonymous = await seedDevice(t);
  await expect(
    anonymous.as.mutation(api.walls.setLayout, {
      ...a.input,
      scope: anonymous.scope,
    }),
  ).rejects.toMatchObject({ data: { code: "sign_in_required" } });
  await expect(b.as.mutation(api.walls.setLayout, a.input)).rejects.toMatchObject({
    data: { code: "sync_scope_changed" },
  });
  await expect(b.as.mutation(api.walls.setLayout, { ...a.input, scope: b.scope })).rejects.toMatchObject({
    data: { code: "not_found" },
  });
  await t.run(async (ctx) => {
    const claim = await ctx.db
      .query("journalClaims")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", a.deviceId))
      .unique();
    await ctx.db.patch("journalClaims", claim!._id, { phase: "saves" });
  });
  await expect(a.as.mutation(api.walls.setLayout, a.input)).rejects.toMatchObject({
    data: { code: "claim_required" },
  });
});

it("shares wall state across devices on the same account", async () => {
  const t = harness();
  const a = await wallFixture(t, "a");
  const other = await seedDevice(t);
  await t.run((ctx) => ctx.db.patch("devices", other.deviceId, { accountId: a.accountId }));
  const mine = await a.as.mutation(api.walls.setLayout, a.input);
  expect(await other.as.query(api.walls.getMine, {})).toMatchObject({
    items: mine.items,
    revision: mine.revision,
  });
});

it.each([
  { color: "#fff" },
  { color: "45524B" },
  { color: "#gggggg" },
  { revision: -1 },
  { layout: { width: 0 } },
  { layout: { x: -0.1 } },
  { layout: { x: 0.6, width: 0.5 } },
  { layout: { y: 100.01 } },
  { layout: { layer: 100 } },
  { layout: { layer: 0.5 } },
])("rejects invalid wall input %j", async (invalid) => {
  const t = harness();
  const a = await wallFixture(t, "a");
  const { layout, ...fields } = invalid;
  await expect(
    a.as.mutation(api.walls.setLayout, {
      ...a.input,
      ...fields,
      items: [{ ...a.selection, layout: { ...a.layout, ...layout } }],
    }),
  ).rejects.toThrow("invalid_wall");
});

it("enforces unique selections and layers, item limits, frame IDs and geometry boundaries", async () => {
  const t = harness();
  const a = await wallFixture(t, "a");
  await expect(
    a.as.mutation(api.walls.setLayout, {
      ...a.input,
      items: [a.selection, a.selection],
    }),
  ).rejects.toThrow("invalid_wall");
  await expect(
    a.as.mutation(api.walls.setLayout, {
      ...a.input,
      items: [a.selection, { ...a.selection, saveLocalId: crypto.randomUUID() }],
    }),
  ).rejects.toThrow("invalid_wall");
  await expect(
    a.as.mutation(api.walls.setLayout, {
      ...a.input,
      items: Array(101).fill(a.selection),
    }),
  ).rejects.toThrow("invalid_wall");
  await expect(
    a.as.mutation(api.walls.setLayout, {
      ...a.input,
      items: [{ ...a.selection, layout: { ...a.layout, frame: "fake" as never } }],
    }),
  ).rejects.toThrow(/Validator error: Expected one of .*, got `"fake"`/);
  let revision = 0;
  for (const frame of ["none", "baroque", "acanthus"]) {
    await expect(
      a.as.mutation(api.walls.setLayout, {
        ...a.input,
        items: [{ ...a.selection, layout: { ...a.layout, frame: frame as never } }],
      }),
    ).rejects.toThrow(/Validator error/);
  }
  for (const { value: frame } of WALL_FRAMES) {
    const result = await a.as.mutation(api.walls.setLayout, {
      ...a.input,
      revision,
      items: [
        {
          ...a.selection,
          layout: { x: 0, y: 100, width: 1, layer: 99, frame },
        },
      ],
    });
    revision = result.revision;
    expect(result.items[0].layout.frame).toBe(frame);
  }
});

it("keeps note consent independent of layout, preserves identity on re-add and resets consent", async () => {
  const t = harness();
  const a = await wallFixture(t, "a");
  const original = await a.as.mutation(api.walls.setLayout, a.input);
  const { itemId } = original.items[0];
  const visible = await a.as.action(api.walls.setNoteVisibility, {
    scope: a.scope,
    changes: [{ itemId, noteRevision: 0, visible: true }],
  });
  expect(visible).toMatchObject({
    revision: 1,
    items: [{ noteVisible: true, noteRevision: 1 }],
  });
  const moved = await a.as.mutation(api.walls.setLayout, {
    ...a.input,
    revision: 1,
    color: "#123456",
  });
  expect(moved.items[0]).toMatchObject({ noteVisible: true, noteRevision: 1 });
  await a.as.mutation(api.walls.setLayout, {
    ...a.input,
    revision: 2,
    items: [],
  });
  expect(await t.query(api.walls.getArtwork, { itemId })).toBeNull();
  const readded = await a.as.mutation(api.walls.setLayout, {
    ...a.input,
    revision: 3,
  });
  expect(readded.items[0]).toMatchObject({
    itemId,
    noteVisible: false,
    noteRevision: 2,
  });
  await expect(
    a.as.action(api.walls.setNoteVisibility, {
      scope: a.scope,
      changes: [{ itemId, noteRevision: 1, visible: true }],
    }),
  ).rejects.toMatchObject({ data: { code: "conflict" } });
});

it("makes a shared note private whenever it changes until it is shared again", async () => {
  const t = harness();
  const a = await wallFixture(t, "a");
  const {
    items: [item],
  } = await a.as.mutation(api.walls.setLayout, a.input);
  const share = (noteRevision: number) =>
    a.as.action(api.walls.setNoteVisibility, {
      scope: a.scope,
      changes: [{ itemId: item.itemId, noteRevision, visible: true }],
    });
  await share(0);
  await syncNote(t, a, "Long current note ".repeat(100));
  expect(await t.query(api.walls.getArtwork, { itemId: item.itemId })).not.toHaveProperty("note");
  expect((await a.as.query(api.walls.getMine, {})).items[0]).toMatchObject({ noteVisible: false, noteRevision: 2 });
  await expect(share(1)).rejects.toMatchObject({ data: { code: "conflict" } });
  await share(2);
  expect(await t.query(api.walls.getArtwork, { itemId: item.itemId })).toMatchObject({
    note: "Long current note ".repeat(100),
  });
  await syncNote(t, a, " ");
  await expect(share(4)).rejects.toThrow("invalid_wall");
});

it("refuses to share an offensive note but lets a note name its museum-titled artwork", async () => {
  const t = harness();
  const a = await wallFixture(t, "a");
  const {
    items: [item],
  } = await a.as.mutation(api.walls.setLayout, a.input);
  const share = async () =>
    a.as.action(api.walls.setNoteVisibility, {
      scope: a.scope,
      changes: [
        {
          itemId: item.itemId,
          noteRevision: (await a.as.query(api.walls.getMine, {})).items[0].noteRevision,
          visible: true,
        },
      ],
    });
  await syncNote(t, a, "What a piece of shit");
  await expect(share()).rejects.toMatchObject({ data: { code: "note_not_allowed" } });
  expect(await t.query(api.walls.getArtwork, { itemId: item.itemId })).not.toHaveProperty("note");
  const record = { title: "Pay Attention Motherfuckers", artist: "Bruce Nauman" };
  await t.run(async (ctx) => {
    const { artworkId } = await seedArtworkWithObject(ctx, { artwork: record });
    await ctx.db.patch("collections", a.saveId, { artworkId, snapshot: record });
  });
  await syncNote(t, a, "Pay Attention Motherfuckers is still loud in person");
  await share();
  expect(await t.query(api.walls.getArtwork, { itemId: item.itemId })).toMatchObject({
    note: "Pay Attention Motherfuckers is still loud in person",
  });
});

it("keeps slurs and the strongest swearing in typed artwork details off public walls", async () => {
  const t = harness();
  const a = await wallFixture(t, "a");
  await t.run((ctx) =>
    ctx.db.patch("collections", a.saveId, {
      snapshot: { title: "Fuck on canvas", artist: "Some cunt", date: "1900", medium: "Fucking oil" },
    }),
  );
  await a.as.mutation(api.walls.setLayout, a.input);
  const publicWall = await t.query(api.walls.getPublic, { profileId: a.profile.profileId });
  expect(publicWall!.items[0].artwork).toEqual({
    title: "Untitled",
    artist: "",
    date: "1900",
    media: { kind: "placeholder", width: 1, height: 1 },
  });
  expect((await a.as.query(api.walls.getMine, {})).items[0].artwork.title).toBe("Untitled");
  const crude = { title: "Piss Flowers", artist: "Helen Chadwick", medium: "Shitty bronze" };
  await t.run((ctx) => ctx.db.patch("collections", a.saveId, { snapshot: crude }));
  expect((await t.query(api.walls.getPublic, { profileId: a.profile.profileId }))!.items[0].artwork).toMatchObject(
    crude,
  );
});

it("keeps the museum's own title on public walls even when it contains flagged words", async () => {
  const t = harness();
  const a = await wallFixture(t, "a");
  const record = { title: "Pay Attention Motherfuckers", artist: "Bruce Nauman" };
  await t.run(async (ctx) => {
    const { artworkId } = await seedArtworkWithObject(ctx, { artwork: record });
    await ctx.db.patch("collections", a.saveId, { artworkId, snapshot: { ...record, date: "1973" } });
  });
  await a.as.mutation(api.walls.setLayout, a.input);
  const publicWall = await t.query(api.walls.getPublic, { profileId: a.profile.profileId });
  expect(publicWall!.items[0].artwork).toMatchObject({ ...record, date: "1973" });
  await t.run((ctx) =>
    ctx.db.patch("collections", a.saveId, { snapshot: { ...record, title: "Pay attention, you motherfuckers" } }),
  );
  expect((await t.query(api.walls.getPublic, { profileId: a.profile.profileId }))!.items[0].artwork.title).toBe(
    "Untitled",
  );
});

it("makes visibility batches atomic and refuses another owner’s item", async () => {
  const t = harness();
  const a = await wallFixture(t, "a");
  const b = await wallFixture(t, "b");
  const {
    items: [first],
  } = await a.as.mutation(api.walls.setLayout, a.input);
  const {
    items: [second],
  } = await b.as.mutation(api.walls.setLayout, b.input);
  await expect(
    a.as.action(api.walls.setNoteVisibility, {
      scope: a.scope,
      changes: [first, second].map((item) => ({
        itemId: item.itemId,
        noteRevision: 0,
        visible: true,
      })),
    }),
  ).rejects.toMatchObject({ data: { code: "not_found" } });
  expect((await a.as.query(api.walls.getMine, {})).items[0].noteVisible).toBe(false);
});

it("allowlists public data and keeps snapshot metadata without catalog enrichment", async () => {
  const t = harness();
  const a = await wallFixture(t, "a");
  const {
    items: [item],
  } = await a.as.mutation(api.walls.setLayout, a.input);
  const publicWall = await t.query(api.walls.getPublic, {
    profileId: a.profile.profileId,
  });
  expect(Object.keys(publicWall!).sort()).toEqual(["artworkCount", "color", "items", "profileId"]);
  expect(Object.keys(publicWall!.items[0]).sort()).toEqual(["artwork", "itemId", "layout"]);
  expect(publicWall!.items[0].artwork).toEqual({
    title: "Saved title",
    artist: "Saved artist",
    date: "1900",
    medium: "Oil",
    media: { kind: "placeholder", width: 1, height: 1 },
  });
  expect(JSON.stringify(publicWall)).not.toContain(a.saveLocalId);
  expect(await t.query(api.walls.getArtwork, { itemId: item.itemId })).toEqual({
    ...publicWall!.items[0],
    profileId: a.profile.profileId,
    photos: [publicWall!.items[0].artwork.media],
  });
});

it("counts artworks by save so a second placement of the same work adds a piece, not an artwork", async () => {
  const t = harness();
  const a = await wallFixture(t, "a");
  const second = {
    ...a.selection,
    placementId: crypto.randomUUID(),
    layout: { ...a.layout, x: 0.5, layer: 1 },
  };
  await a.as.mutation(api.walls.setLayout, {
    ...a.input,
    items: [a.selection, second],
  });
  expect(await t.query(api.walls.getPublic, { profileId: a.profile.profileId })).toMatchObject({
    artworkCount: 1,
    items: [{ layout: a.layout }, { layout: second.layout }],
  });
});

it.each(["deleted", "missing", "inactive", "wrong-owner", "wrong-parent"] as const)(
  "checks current parents before direct and wall reads: %s",
  async (change) => {
    const t = harness();
    const a = await wallFixture(t, "a");
    const b = await wallFixture(t, "b");
    const {
      items: [item],
    } = await a.as.mutation(api.walls.setLayout, a.input);
    await t.run(async (ctx) => {
      if (change === "deleted") await ctx.db.patch("collections", a.saveId, { deletedAt: 1 });
      if (change === "missing") await ctx.db.delete("collections", a.saveId);
      if (change === "inactive") {
        await ctx.db.patch("profiles", a.profile.profileId, { active: false });
      }
      if (change === "wrong-owner") {
        await ctx.db.patch("collections", a.saveId, {
          owner: { kind: "account", accountId: b.accountId },
        });
      }
      if (change === "wrong-parent") {
        await ctx.db.patch("wallItems", item.itemId, { profileId: b.profile.profileId });
      }
    });
    expect(await t.query(api.walls.getArtwork, { itemId: item.itemId })).toBeNull();
    expect((await t.query(api.walls.getPublic, { profileId: a.profile.profileId }))?.items ?? []).toEqual([]);
  },
);

it("invalidates deleted selections atomically and removal retries do not advance revisions", async () => {
  const t = harness();
  const a = await wallFixture(t, "a");
  await a.as.mutation(api.walls.setLayout, a.input);
  await a.as.mutation(api.collections.remove, {
    scope: a.scope,
    localId: a.saveLocalId,
  });
  const before = await a.as.query(api.walls.getMine, {});
  expect(before).toMatchObject({ revision: 2, items: [] });
  await a.as.mutation(api.collections.remove, {
    scope: a.scope,
    localId: a.saveLocalId,
  });
  expect(await a.as.query(api.walls.getMine, {})).toEqual(before);
  expect(await t.query(api.profiles.getPublic, { profileId: a.profile.profileId })).toMatchObject({
    publishedWallCount: 0,
  });
});

it("removes the wall and its selections when the account is purged", async () => {
  vi.useFakeTimers();
  const t = harness();
  const a = await wallFixture(t, "a");
  const {
    items: [item],
  } = await a.as.mutation(api.walls.setLayout, a.input);
  await a.as.mutation(api.accounts.deleteAccount, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await t.run((ctx) => ctx.db.get("collections", a.saveId))).toBeNull();
  expect(await t.run((ctx) => ctx.db.get("wallItems", item.itemId))).toBeNull();
  expect(await t.run((ctx) => ctx.db.query("walls").collect())).toEqual([]);
  expect(await t.query(api.walls.getPublic, { profileId: a.profile.profileId })).toBeNull();
  vi.useRealTimers();
});

it("invalidates a pending opt-in when a private note is emptied and later rewritten", async () => {
  const t = harness();
  const a = await wallFixture(t, "a");
  const {
    items: [item],
  } = await a.as.mutation(api.walls.setLayout, a.input);
  await t.run(async (ctx) => {
    const save = (await ctx.db.get("collections", a.saveId))!;
    const fields = {
      localId: save.localId,
      snapshot: save.snapshot,
      savedAt: save.savedAt,
    };
    await upsertJournalSave(ctx, save.owner, a.deviceId, {
      ...fields,
      note: "",
    });
    await resetNoteSharing(ctx, save._id);
    await upsertJournalSave(ctx, save.owner, a.deviceId, {
      ...fields,
      note: "Replacement private note",
    });
  });
  expect((await a.as.query(api.walls.getMine, {})).items[0].noteRevision).toBe(2);
  await expect(
    a.as.action(api.walls.setNoteVisibility, {
      scope: a.scope,
      changes: [{ itemId: item.itemId, noteRevision: 0, visible: true }],
    }),
  ).rejects.toMatchObject({ data: { code: "conflict" } });
  expect(await t.query(api.walls.getArtwork, { itemId: item.itemId })).not.toHaveProperty("note");
});

it("sorts layers and rejects simultaneous replacements based on the same revision", async () => {
  const t = harness();
  const a = await wallFixture(t, "a");
  const another = await t.run(async (ctx) => {
    const save = (await ctx.db.get("collections", a.saveId))!;
    const { _id, _creationTime, ...fields } = save;
    const localId = crypto.randomUUID();
    await ctx.db.insert("collections", { ...fields, localId });
    return localId;
  });
  const items = [
    { ...a.selection, layout: { ...a.layout, layer: 2 } },
    {
      placementId: another,
      saveLocalId: another,
      layout: { ...a.layout, layer: 1 },
    },
  ];
  const first = await a.as.mutation(api.walls.setLayout, { ...a.input, items });
  expect(first.items.map((item) => item.layout.layer)).toEqual([1, 2]);
  const results = await Promise.allSettled(
    ["#123456", "#654321"].map((color) =>
      a.as.mutation(api.walls.setLayout, {
        ...a.input,
        items,
        revision: 1,
        color,
      }),
    ),
  );
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(results.find((result) => result.status === "rejected")).toMatchObject({
    reason: { data: { code: "conflict" } },
  });
  await expect(a.as.mutation(api.walls.setLayout, { ...a.input, note: "secret" } as never)).rejects.toThrow(
    "Validator error: Unexpected field `note` in object",
  );
  expect(await t.run((ctx) => ctx.db.query("sharedVisits").collect())).toEqual([]);
});

async function galleryFixture() {
  const t = harness();
  const owner = await socialUser(t);
  const viewer = await socialUser(t);
  const visit = await socialVisit(t, owner, 1);
  const save = visit.saves[0];
  const photos = await t.run(async (ctx) => {
    const rows: { id: Id<"artworkPhotos">; localId: string; storageId: Id<"files"> }[] = [];
    for (const kind of ["full", "detail", "label"] as const) {
      const localId = crypto.randomUUID();
      const storageId = await fileStorage.store(ctx, new Blob([kind], { type: "image/jpeg" }));
      const id = await ctx.db.insert("artworkPhotos", {
        owner: { kind: "account", accountId: owner.accountId },
        saveId: save.id,
        savedLocalId: save.localId,
        localId,
        kind,
        visitLocalId: visit.visit.localId,
        capturedAt: rows.length + 1,
        storageId,
        width: 400,
        height: 600,
        updatedAt: 1,
        changeVersion: 1,
      });
      rows.push({ id, localId, storageId });
    }
    return rows;
  });
  const input = {
    scope: owner.scope,
    revision: 0,
    color: "#FCFCF9",
    items: [
      {
        placementId: crypto.randomUUID(),
        saveLocalId: save.localId,
        photoLocalId: photos[0].localId,
        layout: { x: 0, y: 0, width: 0.4, layer: 0, frame: "black" as const },
      },
    ],
  };
  const wall = await owner.as.mutation(api.walls.setLayout, input);
  return { t, owner, viewer, visit, save, photos, wall, input, itemId: wall.items[0].itemId };
}

it("shows the linked crop on the public wall and opens the full photo without publishing the rest of the album", async () => {
  const f = await galleryFixture();
  const cropStorageId = await f.t.run((ctx) =>
    fileStorage.store(ctx, new Blob(["cropped painting"], { type: "image/jpeg" })),
  );
  const { photoUpdatedAt } = await f.owner.as.mutation(internal.collectionPhotos.attach, {
    scope: f.owner.scope,
    localId: f.save.localId,
    kind: "crop",
    photoId: f.photos[0].localId,
    storageId: cropStorageId,
    width: 300,
    height: 200,
  });
  const wall = await f.t.query(api.walls.getPublic, { profileId: f.owner.profileId });
  expect(wall?.items[0].artwork.media).toMatchObject({
    kind: "photo",
    width: 300,
    height: 200,
    reference: { photoLocalId: f.photos[0].localId, variant: "crop" },
  });
  const detail = await f.t.query(api.walls.getArtwork, { itemId: f.itemId });
  expect(detail?.photos).toEqual([
    {
      kind: "photo",
      width: 400,
      height: 600,
      reference: { kind: "wallItem", itemId: f.itemId, photoLocalId: f.photos[0].localId },
    },
  ]);
  const path = `/display-media?kind=wallItem&itemId=${f.itemId}&photoLocalId=${f.photos[0].localId}`;
  const cropPath = `${path}&variant=crop&cropRevision=${photoUpdatedAt}`;
  expect(await (await f.t.fetch(cropPath)).text()).toBe("cropped painting");
  expect(await (await f.t.fetch(path)).text()).toBe("full");
  expect((await f.t.fetch(cropPath.replace(f.photos[0].localId, f.photos[1].localId))).status).toBe(404);
  await f.owner.as.mutation(api.walls.setLayout, { ...f.input, revision: 1, items: [] });
  expect((await f.t.fetch(cropPath)).status).toBe(404);
});

it("includes only photos already shared with this viewer and revokes them when visit access changes", async () => {
  const f = await galleryFixture();
  await f.owner.as.action(api.sharedVisits.publish, {
    ...f.visit.selection,
    photoSelections: [{ saveLocalId: f.save.localId, photoLocalIds: [f.photos[0].localId, f.photos[1].localId] }],
  });
  const read = () => f.t.query(api.walls.getArtwork, { itemId: f.itemId });
  const shared = await read();
  expect(shared?.photos).toHaveLength(2);
  expect(shared?.photos[1]).toMatchObject({ reference: { kind: "sharedVisit", photoLocalId: f.photos[1].localId } });
  expect(JSON.stringify(shared)).not.toContain(f.photos[2].localId);
  const media = shared!.photos[1];
  if (media.kind !== "photo" || media.reference.kind !== "sharedVisit") throw new Error("Expected shared visit photo");
  const ref = media.reference;
  const path = `/display-media?kind=sharedVisit&postId=${ref.postId}&itemId=${ref.itemId}&photoLocalId=${ref.photoLocalId}`;
  expect((await f.t.fetch(path)).status).toBe(200);
  await setVisitVisibility(f.t, f.owner, f.visit.visit._id, "friends");
  expect((await read())?.photos).toHaveLength(1);
  expect((await f.t.fetch(path)).status).toBe(404);
  await befriend(f.owner, f.viewer);
  expect((await f.viewer.as.query(api.walls.getArtwork, { itemId: f.itemId }))?.photos).toHaveLength(2);
  expect((await f.viewer.as.fetch(path)).status).toBe(200);
  await setVisitVisibility(f.t, f.owner, f.visit.visit._id, "private");
  expect((await f.viewer.as.query(api.walls.getArtwork, { itemId: f.itemId }))?.photos).toHaveLength(1);
  expect((await f.viewer.as.fetch(path)).status).toBe(404);
});

it("includes other live wall placements of the artwork once and drops removed photos", async () => {
  const f = await galleryFixture();
  const items = [
    ...f.input.items,
    ...[1, 1].map((photoIndex, index) => ({
      ...f.input.items[0],
      placementId: crypto.randomUUID(),
      photoLocalId: f.photos[photoIndex].localId,
      layout: { ...f.input.items[0].layout, layer: index + 1 },
    })),
  ];
  const wall = await f.owner.as.mutation(api.walls.setLayout, { ...f.input, revision: 1, items });
  expect((await f.t.query(api.walls.getArtwork, { itemId: f.itemId }))?.photos).toHaveLength(2);
  await f.owner.as.mutation(api.walls.setLayout, { ...f.input, revision: wall.revision });
  expect((await f.t.query(api.walls.getArtwork, { itemId: f.itemId }))?.photos).toHaveLength(1);
});

it("versions replacement crops and refuses stale or malformed crop references", async () => {
  const f = await galleryFixture();
  async function uploadCrop(bytes: string) {
    const storageId = await f.t.run((ctx) => fileStorage.store(ctx, new Blob([bytes], { type: "image/jpeg" })));
    const { photoUpdatedAt } = await f.owner.as.mutation(internal.collectionPhotos.attach, {
      scope: f.owner.scope,
      localId: f.save.localId,
      kind: "crop",
      photoId: f.photos[0].localId,
      storageId,
      width: 300,
      height: 200,
    });
    const { media } = (await f.t.query(api.walls.getPublic, { profileId: f.owner.profileId }))!.items[0].artwork;
    expect(media).toMatchObject({ reference: { variant: "crop", cropRevision: photoUpdatedAt } });
    return { media, revision: photoUpdatedAt };
  }
  const previous = await uploadCrop("old crop");
  const current = await uploadCrop("new crop");
  expect(current.revision).toBeGreaterThan(previous.revision);
  expect(current.media).not.toEqual(previous.media);
  const path = `/display-media?kind=wallItem&itemId=${f.itemId}&photoLocalId=${f.photos[0].localId}`;
  const cropPath = `${path}&variant=crop`;
  expect(await (await f.t.fetch(`${cropPath}&cropRevision=${current.revision}`)).text()).toBe("new crop");
  for (const suffix of [
    "",
    `&cropRevision=${previous.revision}`,
    "&cropRevision=NaN",
    "&cropRevision=0",
    "&cropRevision=1.5",
  ]) {
    expect((await f.t.fetch(cropPath + suffix)).status).toBe(404);
  }
  expect((await f.t.fetch(`${path}&cropRevision=${current.revision}`)).status).toBe(404);
  expect(await (await f.t.fetch(path)).text()).toBe("full");
});
