import { expect, it } from "vitest";
import { api } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { harness, type Harness } from "../test.helpers";
import {
  setVisitVisibility,
  socialUser,
  socialVisit,
} from "./socialTestFixtures";
import { wallFixture } from "./wallFixtures";

const source = {
  id: "museum",
  sourceUrl: "https://museum.example/work",
  sourceLabel: "Museum",
};
const docent = [
  { sentence: "Painted beside the garden.", factIds: ["museum"] },
];
const enrichment = { docent, factSheet: [source] };
async function addStory(
  t: Harness,
  saveId: Id<"collections">,
  patch: Partial<Doc<"artworks">> = {},
) {
  return t.run(async (ctx) => {
    const id = await ctx.db.insert("artworks", {
      identityStatus: "established",
      key: "garden",
      title: "Garden",
      artist: "Artist",
      rightsStatus: "public_domain",
      multiplicity: "unique",
      factSheet: [{ ...source, text: "Internal fact text", sourceScore: 1 }],
      docent: {
        en: [
          ...docent,
          { sentence: "Unsupported claim", factIds: ["missing"] },
        ],
      },
      ...patch,
    });
    await ctx.db.patch(saveId, { artworkId: id });
    return id;
  });
}

it("exposes only cited story fields through an active public wall item", async () => {
  const t = harness(),
    owner = await wallFixture(t);
  await addStory(t, owner.saveId);
  const wall = await owner.as.mutation(api.walls.setLayout, owner.input),
    itemId = wall.items[0].itemId;
  const detail = await t.query(api.walls.getArtwork, { itemId });
  expect(detail?.enrichment).toEqual(enrichment);
  expect(JSON.stringify(detail)).not.toMatch(
    /Internal fact|Unsupported claim|Private journal|sourceScore|artworkId|saveLocalId/,
  );
  expect(
    (await t.query(api.walls.getPublic, { profileId: owner.profile.profileId }))
      ?.items[0],
  ).not.toHaveProperty("enrichment");
  await owner.as.mutation(api.walls.setLayout, {
    ...owner.input,
    revision: wall.revision,
    items: [],
  });
  expect(await t.query(api.walls.getArtwork, { itemId })).toBeNull();
});

it.each([
  { retiredAt: 1 },
  { identityStatus: "tentative" as const },
  { factSheetNeedsReview: true },
  { docent: { en: [] } },
])("omits stories that are unavailable or need review: %j", async (patch) => {
  const t = harness(),
    owner = await wallFixture(t);
  await addStory(t, owner.saveId, patch);
  const wall = await owner.as.mutation(api.walls.setLayout, owner.input);
  expect(
    await t.query(api.walls.getArtwork, { itemId: wall.items[0].itemId }),
  ).not.toHaveProperty("enrichment");
});

it("returns public visit stories without friendship and revokes access when made private", async () => {
  const t = harness(),
    owner = await socialUser(t),
    reader = await socialUser(t),
    draft = await socialVisit(t, owner, 1);
  await addStory(t, draft.saves[0].id);
  const publication = await owner.as.mutation(
      api.sharedVisits.publish,
      draft.selection,
    ),
    postId = publication.postId!;
  const post = await owner.as.query(api.sharedVisits.get, { postId }),
    itemId = post.artworks.page[0].itemId;
  expect(post.artworks.page[0]).not.toHaveProperty("enrichment");
  expect(
    (await t.query(api.sharedVisits.getArtwork, { postId, itemId })).enrichment,
  ).toEqual(enrichment);
  const detail = await reader.as.query(api.sharedVisits.getArtwork, {
    postId,
    itemId,
  });
  expect(detail.enrichment).toEqual(enrichment);
  expect(JSON.stringify(detail)).not.toMatch(
    /PRIVATE|Internal fact|Unsupported claim|sourceScore|artworkId/,
  );
  await setVisitVisibility(t, owner, draft.visit._id, "private");
  await expect(
    reader.as.query(api.sharedVisits.getArtwork, { postId, itemId }),
  ).rejects.toMatchObject({ data: { code: "not_found" } });
});
