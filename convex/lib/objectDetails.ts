import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export type ObjectDetailsFields = Omit<Doc<"objectDetails">, "_id" | "_creationTime">;

export function readObjectDetails(ctx: QueryCtx, object: Pick<Doc<"objects">, "detailsId">) {
  return object.detailsId ? ctx.db.get("objectDetails", object.detailsId) : Promise.resolve(null);
}

export async function patchObjectDetails(
  ctx: MutationCtx,
  object: Pick<Doc<"objects">, "_id">,
  patch: ObjectDetailsFields,
): Promise<void> {
  // Re-read the pointer so several updates in one transaction cannot orphan a newly created row.
  const current = await ctx.db.get("objects", object._id);
  if (!current) throw new Error("Object not found");
  const details = await readObjectDetails(ctx, current);
  const { _id, _creationTime, ...previous } = details ?? {};
  const fields = { ...previous, ...patch };
  if (Object.values(fields).every((value) => value === undefined)) {
    if (_id) await ctx.db.delete("objectDetails", _id);
    if (current.detailsId) await ctx.db.patch("objects", current._id, { detailsId: undefined });
  } else if (_id) {
    await ctx.db.patch("objectDetails", _id, patch);
  } else {
    const detailsId = await ctx.db.insert("objectDetails", fields);
    await ctx.db.patch("objects", current._id, { detailsId });
  }
}
