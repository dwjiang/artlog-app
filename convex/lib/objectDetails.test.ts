import { expect, it } from "vitest";

import { harness } from "../test.helpers";
import { patchObjectDetails, readObjectDetails } from "./objectDetails";
import { seedArtworkWithObject } from "./testFactories";

it("reuses the detail row across consecutive updates and deletes it when the last fields are cleared", async () => {
  const t = harness();
  await t.run(async (ctx) => {
    const { objectId } = await seedArtworkWithObject(ctx, {
      objectDetails: { medium: undefined, thumbnailUrl: undefined },
    });
    const object = (await ctx.db.get("objects", objectId))!;
    expect(object.detailsId).toBeUndefined();
    await patchObjectDetails(ctx, object, { medium: "Oil", thumbnailUrl: "https://museum.example/one.jpg" });
    const first = (await ctx.db.get("objects", objectId))!;
    await patchObjectDetails(ctx, object, { medium: "Oil on canvas" });
    const updated = (await ctx.db.get("objects", objectId))!;
    expect(updated.detailsId).toBe(first.detailsId);
    expect(await readObjectDetails(ctx, updated)).toMatchObject({
      medium: "Oil on canvas",
      thumbnailUrl: "https://museum.example/one.jpg",
    });
    expect(await ctx.db.query("objectDetails").collect()).toHaveLength(1);
    await patchObjectDetails(ctx, object, { thumbnailUrl: undefined });
    expect(await readObjectDetails(ctx, updated)).toMatchObject({ medium: "Oil on canvas" });
    await patchObjectDetails(ctx, object, { medium: undefined });
    expect((await ctx.db.get("objects", objectId))!.detailsId).toBeUndefined();
    expect(await ctx.db.query("objectDetails").collect()).toEqual([]);
  });
});

it("does not allocate a details row for an object without display metadata", async () => {
  const t = harness();
  await t.run(async (ctx) => {
    const { objectId } = await seedArtworkWithObject(ctx, {
      objectDetails: { medium: undefined, thumbnailUrl: undefined },
    });
    await patchObjectDetails(ctx, { _id: objectId }, { pageUrl: undefined });
    const object = (await ctx.db.get("objects", objectId))!;
    expect(await readObjectDetails(ctx, object)).toBeNull();
    expect(await ctx.db.query("objectDetails").collect()).toEqual([]);
  });
});
