import { expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";
import { harness } from "./test.helpers";
import { befriend, setVisitVisibility, socialDerivative, socialUser, socialVisit } from "./lib/socialTestFixtures";
import { serveSharedMedia } from "./sharedMedia";

async function fixture() {
  const t = harness(),
    a = await socialUser(t),
    b = await socialUser(t),
    draft = await socialVisit(t, a, 1);
  const asset = await socialDerivative(t, a, draft.saves[0].id);
  const previewContext = {
    kind: "sharedVisitPreview" as const,
    visitLocalId: draft.visit.localId,
    saveLocalId: draft.saves[0].localId,
  };
  const getStored = async (id: typeof asset.storageId) => {
    const stored = await t.run(async (ctx) => {
      const blob = await ctx.storage.get(id);
      return blob ? { body: await blob.text(), type: blob.type } : null;
    });
    return stored ? new Blob([stored.body], { type: stored.type }) : null;
  };
  const transport = (user = a) => ({
    runQuery: user.as.query as ActionCtx["runQuery"],
    storage: { get: getStored },
  });
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
  return { t, a, b, draft, asset, previewContext, transport, publish };
}
it("displays eligible draft media only to the owner without publishing or exposing storage IDs", async () => {
  const { t, a, b, draft, asset, previewContext, transport } = await fixture();
  const preview = await a.as.query(api.sharedVisits.preview, draft.selection);
  expect(preview.artworks[0].artwork.media).toMatchObject({
    kind: "derivative",
    reference: previewContext,
  });
  expect(JSON.stringify(preview)).not.toContain(asset.storageId);
  const response = await serveSharedMedia(transport(), previewContext);
  expect(await response.text()).toBe("derivative bytes");
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  await befriend(a, b);
  const denied = await serveSharedMedia(transport(b), previewContext);
  expect(denied.status).toBe(404);
  expect(denied.headers.get("Cache-Control")).toBe("private, no-store");
  expect(await t.run((ctx) => ctx.db.query("sharedVisits").collect())).toEqual([]);
});
it("serves public media without friendship and rechecks publication, selection, and media eligibility", async () => {
  const { t, a, b, draft, asset, transport, publish } = await fixture();
  const context = await publish();
  expect((await serveSharedMedia(transport(b), context)).status).toBe(200);
  await t.run((ctx) => ctx.db.patch(asset.id, { revokedAt: 1 }));
  expect((await serveSharedMedia(transport(b), context)).status).toBe(404);
  await t.run((ctx) => ctx.db.patch(asset.id, { revokedAt: undefined }));
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
it("denies an owner-photo pointer and a publication revoked during the storage fetch", async () => {
  const { t, a, b, draft, asset, transport, publish } = await fixture();
  const context = await publish();
  await befriend(a, b);
  const pointer = await t.run(async (ctx) => {
    const save = (await ctx.db.get(draft.saves[0].id))!;
    return ctx.db.insert("artworkPhotos", {
      owner: save.owner,
      saveId: save._id,
      savedLocalId: save.localId,
      localId: crypto.randomUUID(),
      kind: "full",
      capturedAt: 1,
      storageId: asset.storageId,
      updatedAt: 1,
      changeVersion: 1,
    });
  });
  expect((await serveSharedMedia(transport(b), context)).status).toBe(404);
  await t.run((ctx) => ctx.db.delete(pointer));
  const response = await serveSharedMedia(
    {
      ...transport(b),
      storage: {
        get: async (id: typeof asset.storageId) => {
          const blob = await transport(b).storage.get(id);
          await setVisitVisibility(t, a, draft.visit._id, "private");
          return blob;
        },
      },
    },
    context,
  );
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ code: "not_found" });
});
it("revokes media when an author is removed even while its publication remains active", async () => {
  const { t, a, b, transport, publish } = await fixture();
  const context = await publish();
  await befriend(a, b);
  const reportId = await b.as.mutation(api.reports.submit, {
    target: { kind: "profile", profileId: a.profileId },
    reason: "Abuse",
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
  await t.run((ctx) => ctx.db.patch(asset.contributionId, { displayMediaRevokedAt: Date.now() }));
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
    await ctx.db.patch(asset.contributionId, {
      displayMediaRevokedAt: undefined,
    });
    await ctx.db.patch(asset.id, { storageId: asset.sourceStorageId });
  });
  expect((await serveSharedMedia(transport(b), context)).status).toBe(404);
});
