import { expect, it } from "vitest";

import { harness } from "../test.helpers";
import { patchArtworkContent, readArtworkContent } from "./artworkContent";
import { seedArtworkWithObject } from "./testFactories";

const factSheet = [
  {
    id: "f1",
    text: "Painted beside the garden.",
    sourceUrl: "https://museum.example/work",
    sourceLabel: "Museum",
    sourceScore: 1,
  },
];
const docent = { en: [{ sentence: "Painted beside the garden.", factIds: ["f1"] }] };

it("keeps consecutive content updates on a single row when the caller holds an older artwork", async () => {
  const t = harness();
  await t.run(async (ctx) => {
    const { artworkId } = await seedArtworkWithObject(ctx);
    const artwork = (await ctx.db.get("artworks", artworkId))!;
    await patchArtworkContent(ctx, artwork, { factSheet });
    await patchArtworkContent(ctx, artwork, { docent });

    const current = (await ctx.db.get("artworks", artworkId))!;
    expect(current).not.toHaveProperty("factSheet");
    expect(current).not.toHaveProperty("docent");
    expect(await readArtworkContent(ctx, current)).toMatchObject({ factSheet, docent });
    expect(await ctx.db.query("artworkContent").collect()).toHaveLength(1);
  });
});

it("preserves research when prose is cleared and removes the content row when the final field is cleared", async () => {
  const t = harness();
  await t.run(async (ctx) => {
    const { artworkId } = await seedArtworkWithObject(ctx, { artworkContent: { factSheet, docent } });
    const artwork = (await ctx.db.get("artworks", artworkId))!;
    const contentId = artwork.contentId!;
    await patchArtworkContent(ctx, artwork, { docent: undefined });
    const research = await readArtworkContent(ctx, artwork);
    expect(research).toMatchObject({ _id: contentId, factSheet });
    expect(research).not.toHaveProperty("docent");

    await patchArtworkContent(ctx, artwork, { factSheet: undefined });
    const cleared = (await ctx.db.get("artworks", artworkId))!;
    expect(cleared).not.toHaveProperty("contentId");
    expect(await readArtworkContent(ctx, cleared)).toBeNull();
    expect(await ctx.db.get("artworkContent", contentId)).toBeNull();

    await patchArtworkContent(ctx, artwork, { docent: undefined });
    await patchArtworkContent(ctx, artwork, {});
    expect(await ctx.db.query("artworkContent").collect()).toEqual([]);

    await patchArtworkContent(ctx, artwork, { docent });
    const renewed = (await ctx.db.get("artworks", artworkId))!;
    expect(await readArtworkContent(ctx, renewed)).toMatchObject({ docent });
    expect(await ctx.db.query("artworkContent").collect()).toHaveLength(1);
  });
});
