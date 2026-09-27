import { expect, it, vi } from "vitest";

import { api, internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";
import { fileStorage } from "./lib/fileStorage";
import { befriend, setVisitVisibility, socialDerivative, socialUser, socialVisit } from "./lib/socialTestFixtures";
import { serveSharedMedia } from "./sharedMedia";
import { harness } from "./test.helpers";

async function fixture() {
  const t = harness();
  const a = await socialUser(t);
  const b = await socialUser(t);
  const draft = await socialVisit(t, a, 1);
  const asset = await socialDerivative(t, a, draft.saves[0].id);
  const transport = (user = a) => ({ runQuery: user.as.query as ActionCtx["runQuery"] });
  const publish = async () => {
    const state = await a.as.mutation(api.sharedVisits.publish, draft.selection);
    const post = await a.as.query(api.sharedVisits.get, {
      postId: state.postId!,
    });
    return {
      kind: "sharedVisit" as const,
      postId: state.postId!,
      itemId: post.artworks.page[0].itemId,
    };
  };
  return { t, a, b, draft, asset, transport, publish };
}

it("serves public media without friendship and rechecks publication, selection, and media eligibility", async () => {
  const { t, a, b, draft, asset, transport, publish } = await fixture();
  const context = await publish();
  expect((await serveSharedMedia(transport(b), context)).status).toBe(200);
  await t.run((ctx) => ctx.db.patch("mediaAssets", asset.id, { revokedAt: 1 }));
  expect((await serveSharedMedia(transport(b), context)).status).toBe(404);
  await t.run((ctx) => ctx.db.patch("mediaAssets", asset.id, { revokedAt: undefined }));
  await a.as.mutation(api.sharedVisits.publish, {
    ...draft.selection,
    saveLocalIds: [],
    revision: 1,
  });
  expect((await serveSharedMedia(transport(b), context)).status).toBe(404);
  await expect(
    b.as.query(internal.sharedMedia.authorize, {
      context: { ...context, postId: crypto.randomUUID() },
    }),
  ).rejects.toMatchObject({ data: { code: "not_found" } });
});

it.each([undefined, 1])(
  "denies current and deleted owner-photo pointers permanently (deletedAt=%s)",
  async (deletedAt) => {
    const { t, a, b, draft, asset, transport, publish } = await fixture();
    const context = await publish();
    await befriend(a, b);
    const pointer = await t.run(async (ctx) => {
      const save = (await ctx.db.get("collections", draft.saves[0].id))!;
      return ctx.db.insert("artworkPhotos", {
        owner: save.owner,
        saveId: save._id,
        savedLocalId: save.localId,
        localId: crypto.randomUUID(),
        kind: "full",
        capturedAt: 1,
        deletedAt,
        storageId: asset.storageId,
        updatedAt: 1,
        changeVersion: 1,
      });
    });
    expect((await serveSharedMedia(transport(b), context)).status).toBe(404);
    await t.run((ctx) => ctx.db.delete("artworkPhotos", pointer));
    expect((await serveSharedMedia(transport(b), context)).status).toBe(404);
  },
);

it("denies a publication revoked during the storage fetch", async () => {
  const { t, a, b, draft, transport, publish } = await fixture();
  const context = await publish();
  const { get } = fileStorage;
  const fetch = vi.spyOn(fileStorage, "get").mockImplementationOnce(async (ctx, id) => {
    const blob = await get(ctx, id);
    await setVisitVisibility(t, a, draft.visit._id, "private");
    return blob;
  });
  const response = await serveSharedMedia(transport(b), context);
  expect(fetch).toHaveBeenCalledOnce();
  fetch.mockRestore();
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ code: "not_found" });
});

it("revokes media when an author is removed even while its publication remains active", async () => {
  const { t, a, b, transport, publish } = await fixture();
  const context = await publish();
  await befriend(a, b);
  const reportId = await b.as.mutation(api.reports.submit, {
    target: { kind: "profile", profileId: a.profileId },
    reason: "harassment",
  });
  await t.mutation(internal.review.decideReport, {
    reportId,
    operator: "op",
    decision: "remove",
    reason: "Confirmed",
  });
  expect((await serveSharedMedia(transport(b), context)).status).toBe(404);
});

it("checks current contribution consent and never serves the source crop as a derivative", async () => {
  const { t, a, b, asset, transport, publish } = await fixture();
  const context = await publish();
  await befriend(a, b);
  await t.run((ctx) => ctx.db.patch("contributions", asset.contributionId, { displayMediaRevokedAt: Date.now() }));
  expect((await serveSharedMedia(transport(b), context)).status).toBe(404);
  expect(
    (
      await b.as.query(api.sharedVisits.getArtwork, {
        postId: context.postId,
        itemId: context.itemId,
      })
    ).artwork.media.kind,
  ).toBe("placeholder");
  await t.run(async (ctx) => {
    await ctx.db.patch("contributions", asset.contributionId, {
      displayMediaRevokedAt: undefined,
    });
    await ctx.db.patch("mediaAssets", asset.id, { storageId: asset.sourceStorageId });
  });
  expect((await serveSharedMedia(transport(b), context)).status).toBe(404);
});
