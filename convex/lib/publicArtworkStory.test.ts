import { expect, it } from "vitest";

import { api } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { harness, type Harness } from "../test.helpers";
import type { ArtworkContentFields } from "./artworkContent";
import { setVisitVisibility, socialUser, socialVisit } from "./socialTestFixtures";
import { wallFixture } from "./wallFixtures";

const source = {
  id: "museum",
  sourceUrl: "https://museum.example/work",
  sourceLabel: "Museum",
};
const docent = [{ sentence: "Painted beside the garden.", factIds: ["museum"] }];
const enrichment = { docent, factSheet: [source] };
async function addStory(
  t: Harness,
  saveId: Id<"collections">,
  patch: Partial<Doc<"artworks">> = {},
  content: ArtworkContentFields = {},
) {
  return t.run(async (ctx) => {
    const contentId = await ctx.db.insert("artworkContent", {
      factSheet: [{ ...source, text: "Internal fact text", sourceScore: 1 }],
      docent: { en: [...docent, { sentence: "Unsupported claim", factIds: ["missing"] }] },
      ...content,
    });
    const id = await ctx.db.insert("artworks", {
      identityStatus: "established",
      key: "garden",
      title: "Garden",
      artist: "Artist",
      rightsStatus: "public_domain",
      multiplicity: "unique",
      enrichGeneration: 0,
      contentId,
      ...patch,
    });
    await ctx.db.patch("collections", saveId, { artworkId: id });
    return id;
  });
}

it("exposes only cited story fields through an active public wall item", async () => {
  const t = harness();
  const owner = await wallFixture(t);
  await addStory(t, owner.saveId);
  const wall = await owner.as.mutation(api.walls.setLayout, owner.input);
  const { itemId } = wall.items[0];
  const detail = await t.query(api.walls.getArtwork, { itemId });
  expect(detail?.enrichment).toEqual(enrichment);
  expect(JSON.stringify(detail)).not.toMatch(
    /Internal fact|Unsupported claim|Private journal|sourceScore|artworkId|saveLocalId/,
  );
  expect((await t.query(api.walls.getPublic, { profileId: owner.profile.profileId }))?.items[0]).not.toHaveProperty(
    "enrichment",
  );
  await owner.as.mutation(api.walls.setLayout, {
    ...owner.input,
    revision: wall.revision,
    items: [],
  });
  expect(await t.query(api.walls.getArtwork, { itemId })).toBeNull();
});

it.each([
  { artwork: { retiredAt: 1 } },
  { artwork: { identityStatus: "tentative" as const } },
  { artwork: { factSheetNeedsReview: true } },
  { content: { docent: { en: [] } } },
])("omits stories that are unavailable or need review: %j", async (patch) => {
  const t = harness();
  const owner = await wallFixture(t);
  await addStory(t, owner.saveId, patch.artwork, patch.content);
  const wall = await owner.as.mutation(api.walls.setLayout, owner.input);
  expect(await t.query(api.walls.getArtwork, { itemId: wall.items[0].itemId })).not.toHaveProperty("enrichment");
});

it("returns public visit stories without friendship and revokes access when made private", async () => {
  const t = harness();
  const owner = await socialUser(t);
  const reader = await socialUser(t);
  const draft = await socialVisit(t, owner, 1);
  await addStory(t, draft.saves[0].id);
  const publication = await owner.as.mutation(api.sharedVisits.publish, draft.selection);
  const postId = publication.postId!;
  const post = await owner.as.query(api.sharedVisits.get, { postId });
  const { itemId } = post.artworks.page[0];
  expect(post.artworks.page[0]).not.toHaveProperty("enrichment");
  expect((await t.query(api.sharedVisits.getArtwork, { postId, itemId })).enrichment).toEqual(enrichment);
  const detail = await reader.as.query(api.sharedVisits.getArtwork, {
    postId,
    itemId,
  });
  expect(detail.enrichment).toEqual(enrichment);
  expect(JSON.stringify(detail)).not.toMatch(/PRIVATE|Internal fact|Unsupported claim|sourceScore|artworkId/);
  await setVisitVisibility(t, owner, draft.visit._id, "private");
  await expect(reader.as.query(api.sharedVisits.getArtwork, { postId, itemId })).rejects.toMatchObject({
    data: { code: "not_found" },
  });
});
