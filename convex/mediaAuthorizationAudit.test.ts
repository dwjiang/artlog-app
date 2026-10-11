import { afterEach, beforeEach, expect, it, vi } from "vitest";

import model from "../shared/model/model-version.json";
import { api, internal } from "./_generated/api";
import { fileStorage, retainFile } from "./lib/fileStorage";
import { narrationProvenance, renderedNarration } from "./lib/narrationCache";
import { befriend, setVisitVisibility, socialDerivative, socialUser, socialVisit } from "./lib/socialTestFixtures";
import { seedArtworkWithObject, seedContribution, seedMuseum, seedPublishedContribution } from "./lib/testFactories";
import { harness } from "./test.helpers";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
});

const relativeUrl = (url: string) => new URL(url).pathname + new URL(url).search;

it("rejects anonymous calls to every device- or profile-gated public media RPC", async () => {
  const t = harness();
  const { artworkId, venueId } = await t.run(async (ctx) => {
    const venueId = await seedMuseum(ctx);
    return { ...(await seedArtworkWithObject(ctx)), venueId };
  });
  for (const invoke of [
    () => t.action(api.profilePhotos.save, { name: "Intruder" }),
    () => t.action(api.demoActivityPhotos.uploadPhoto, { jpeg: new ArrayBuffer(0) }),
    () => t.query(api.museumPhotos.forVenue, { venueId }),
    () => t.mutation(api.museumPhotos.request, { venueId }),
    () => t.query(api.museumDownloads.catalog, { paginationOpts: { numItems: 10, cursor: null } }),
    () => t.query(api.museumDownloads.get, { venueId }),
    () => t.action(api.narration.render, { artworkId }),
  ]) {
    await expect(invoke()).rejects.toThrow("unauthenticated");
  }
});

async function profilePhotoFixture() {
  const t = harness();
  const owner = await socialUser(t);
  const fileId = await t.run((ctx) => fileStorage.store(ctx, new Blob(["profile photo"], { type: "image/jpeg" })));
  const profile = await owner.as.mutation(internal.profilePhotoData.save, {
    profileId: owner.profileId,
    name: "Photo owner",
    photo: fileId,
  });
  const path = relativeUrl(profile.photoUrl!);
  expect((await t.fetch(path)).status).toBeLessThan(400);
  return { t, owner, fileId, path };
}

it("revokes a moderated profile photo at its previously published file URL", async () => {
  const { t, owner, path } = await profilePhotoFixture();
  const reportId = await t.run((ctx) =>
    ctx.db.insert("reports", {
      target: { kind: "profile", profileId: owner.profileId },
      reason: "spam",
      evidence: { kind: "profile", profileId: owner.profileId, username: "photo_owner", name: "Photo owner" },
      status: "open",
    }),
  );
  await t.mutation(internal.review.decideReport, { reportId, operator: "audit", decision: "remove", reason: "Spam" });
  expect(await t.query(api.profiles.getPublic, { profileId: owner.profileId })).toBeNull();
  expect((await t.fetch(path)).status).toBe(404);
});

it("revokes a deleted account's profile photo before asynchronous purge", async () => {
  const { t, owner, path } = await profilePhotoFixture();
  await owner.as.mutation(api.accounts.deleteAccount, {});
  expect(await t.query(api.profiles.getPublic, { profileId: owner.profileId })).toBeNull();
  expect((await t.fetch(path)).status).toBe(404);
});

it.each(["unlink", "delete", "replace"] as const)(
  "does not finish a private photo read after %s during storage IO",
  async (change) => {
    const t = harness();
    const owner = await socialUser(t);
    const { saves } = await socialVisit(t, owner, 1);
    const fileId = await t.run((ctx) => fileStorage.store(ctx, new Blob(["private crop"], { type: "image/jpeg" })));
    await owner.as.mutation(internal.collectionPhotos.attach, {
      scope: owner.scope,
      localId: saves[0].localId,
      kind: "crop",
      storageId: fileId,
    });
    const path = `/collection-photo?scope=${encodeURIComponent(owner.scope)}&localId=${saves[0].localId}&kind=crop`;
    expect((await owner.as.fetch(path)).status).toBe(200);
    const { get } = fileStorage;
    vi.spyOn(fileStorage, "get").mockImplementationOnce(async (ctx, id) => {
      const bytes = await get(ctx, id);
      if (change === "unlink") await owner.as.mutation(api.accounts.unlink, {});
      if (change === "delete") {
        await owner.as.mutation(api.collections.remove, { scope: owner.scope, localId: saves[0].localId });
      }
      if (change === "replace") {
        const replacement = await t.run((ctx) =>
          fileStorage.store(ctx, new Blob(["replacement"], { type: "image/jpeg" })),
        );
        await owner.as.mutation(internal.collectionPhotos.attach, {
          scope: owner.scope,
          localId: saves[0].localId,
          kind: "crop",
          storageId: replacement,
        });
      }
      return bytes;
    });
    const response = await owner.as.fetch(path);
    expect(response.status).toBe(change === "unlink" ? 409 : 404);
    expect(await response.text()).not.toContain("private crop");
  },
);

it("denies anonymous and unrelated readers of friends media, including saved URLs after friendship revocation", async () => {
  const t = harness();
  const owner = await socialUser(t);
  const friend = await socialUser(t);
  const outsider = await socialUser(t);
  const visit = await socialVisit(t, owner, 1);
  await socialDerivative(t, owner, visit.saves[0].id);
  await befriend(owner, friend);
  await setVisitVisibility(t, owner, visit.visit._id, "friends");
  const state = await owner.as.query(api.sharedVisits.getState, { visitLocalId: visit.visit.localId });
  const post = await owner.as.action(api.sharedVisits.publish, {
    ...visit.selection,
    audience: "friends",
    revision: state.revision,
  });
  const publication = await friend.as.query(api.sharedVisits.get, { postId: post.postId! });
  const path = `/display-media?kind=sharedVisit&postId=${post.postId}&itemId=${publication.artworks.page[0].itemId}`;
  expect((await friend.as.fetch(path)).status).toBe(200);
  expect((await t.fetch(path)).status).toBe(404);
  expect((await outsider.as.fetch(path)).status).toBe(404);
  const relationship = await owner.as.query(api.friendships.getState, { profileId: friend.profileId });
  await owner.as.mutation(api.friendships.remove, { profileId: friend.profileId, revision: relationship.revision });
  expect((await friend.as.fetch(path)).status).toBe(404);
});

it.each([
  ["correction", "finished"],
  ["correction", "segment"],
  ["takedown", "finished"],
  ["takedown", "segment"],
] as const)("revokes published %s narration %s URLs", async (change, kind) => {
  const t = harness();
  const owner = await socialUser(t);
  const { artworkId, storageId, render } = await t.run(async (ctx) => {
    const { artworkId } = await seedArtworkWithObject(ctx, {
      artwork: { factSheetUpdatedAt: 1 },
      artworkContent: {
        factSheet: [
          {
            id: "fact",
            text: "A disputed fact.",
            sourceUrl: "https://museum.example",
            sourceLabel: "Museum",
            sourceScore: 1,
          },
        ],
      },
    });
    const artwork = (await ctx.db.get("artworks", artworkId))!;
    const storageId = await fileStorage.store(ctx, new Blob(["narration"], { type: "audio/mpeg" }));
    await retainFile(ctx, storageId, true);
    const render = crypto.randomUUID();
    await ctx.db.insert("narrationAudio", {
      artworkId,
      ...narrationProvenance(artwork),
      ...(kind === "finished" ? { storageId } : { segments: [{ storageId, duration: 2 }] }),
      claim: render,
      sentences: [{ sentence: "A disputed fact.", factIds: ["fact"], section: "hook" }],
    });
    return { artworkId, storageId, render };
  });
  const uri =
    kind === "finished"
      ? (await t.run(async (ctx) => renderedNarration(ctx, (await ctx.db.get("artworks", artworkId))!)))!.uri
      : (await t.query(internal.narration.listing, { artworkId, render }))!.segments[0].uri;
  const path = relativeUrl(uri);
  expect((await t.fetch(path)).status).toBe(302);
  expect((await t.fetch(`/file?id=${storageId}`)).status).toBe(404);
  for (const replacement of [{ render: "stale-render" }, { artworkId: "not-an-artwork" }]) {
    const forged = new URL(uri);
    for (const [key, value] of Object.entries(replacement)) forged.searchParams.set(key, value);
    expect((await t.fetch(relativeUrl(forged.href))).status).toBe(404);
  }
  if (change === "correction") {
    await owner.as.mutation(api.corrections.correctFact, {
      artworkId,
      factId: "fact",
      message: "The fact is incorrect.",
    });
  } else {
    await t.mutation(internal.revert.applyTakedown, { target: { kind: "artwork", artworkId }, requester: "Museum" });
  }
  expect(await t.query(internal.narration.researchState, { artworkId })).toBe("unavailable");
  expect((await t.fetch(path)).status).toBe(404);
});

it("revokes saved museum package file URLs when the museum opts out", async () => {
  const t = harness();
  const owner = await socialUser(t);
  const { venueId, storageId } = await t.run(async (ctx) => {
    const venueId = await seedMuseum(ctx);
    const storageId = await fileStorage.store(ctx, new Blob(["museum package"], { type: "application/json" }));
    await retainFile(ctx, storageId, true);
    await ctx.db.insert("museumDownloads", {
      venueId,
      published: {
        version: "audit",
        modelVersion: model.modelVersion,
        count: 1,
        size: 14,
        previews: [],
        chunks: [{ storageId, size: 14, sha256: "a".repeat(64) }],
      },
    });
    return { venueId, storageId };
  });
  const manifest = await owner.as.query(api.museumDownloads.get, { venueId });
  expect(manifest).not.toBeNull();
  const uri = manifest!.chunks[0].url;
  const path = relativeUrl(uri);
  expect((await t.fetch(path)).status).toBe(302);
  expect((await t.fetch(`/file?id=${storageId}`)).status).toBe(404);
  for (const replacement of [{ version: "stale-version" }, { venueId: "not-a-museum" }]) {
    const forged = new URL(uri);
    for (const [key, value] of Object.entries(replacement)) forged.searchParams.set(key, value);
    expect((await t.fetch(relativeUrl(forged.href))).status).toBe(404);
  }
  await t.mutation(internal.revert.applyOptOut, { venueId, requester: "Museum" });
  expect(await owner.as.query(api.museumDownloads.get, { venueId })).toBeNull();
  expect((await t.fetch(path)).status).toBe(404);
});

it.each(["opt-out", "takedown", "ban", "delete-account"] as const)(
  "revokes a published contribution crop immediately after %s before cleanup runs",
  async (change) => {
    const t = harness();
    const owner = await socialUser(t);
    const { venueId, objectId, storageId } = await t.run(async (ctx) => {
      const venueId = await seedMuseum(ctx);
      const storageId = await fileStorage.store(ctx, new Blob(["contribution crop"], { type: "image/jpeg" }));
      const contributionId = await seedContribution(ctx, {
        deviceId: owner.deviceId,
        venueId,
        cropStorageId: storageId,
      });
      await retainFile(ctx, storageId, true);
      const objectId = await seedPublishedContribution(ctx, (await ctx.db.get("contributions", contributionId))!);
      return { venueId, objectId, storageId };
    });
    const path = `/file?id=${storageId}`;
    expect((await t.fetch(path)).status).toBe(302);
    if (change === "opt-out") await t.mutation(internal.revert.applyOptOut, { venueId, requester: "Museum" });
    if (change === "takedown") {
      await t.mutation(internal.revert.applyTakedown, { target: { kind: "object", objectId }, requester: "Museum" });
    }
    if (change === "ban") await t.mutation(internal.revert.revertDevice, { deviceId: owner.deviceId, reason: "spam" });
    if (change === "delete-account") await owner.as.mutation(api.accounts.deleteAccount, {});
    expect((await t.fetch(path)).status).toBe(404);
  },
);
