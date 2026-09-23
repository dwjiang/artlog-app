import { ConvexError } from "convex/values";

import {
  decodeOrbFeatures,
  DESCRIPTOR_BYTES,
  KEYPOINT_BYTES,
  MAX_KEYPOINTS,
} from "../../shared/orb/features";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx, MutationCtx } from "../_generated/server";

export const ORB_CONTENT_TYPE = "application/octet-stream";

export function packOrb(descriptors: ArrayBuffer, keypoints: ArrayBuffer): Uint8Array<ArrayBuffer> {
  decodeOrbFeatures(descriptors, keypoints);
  const packed = new Uint8Array(descriptors.byteLength + keypoints.byteLength);
  packed.set(new Uint8Array(descriptors));
  packed.set(new Uint8Array(keypoints), descriptors.byteLength);
  return packed;
}

export async function orbHash(packed: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", packed);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function storeOrb(
  ctx: Pick<ActionCtx, "storage">,
  descriptors: ArrayBuffer,
  keypoints: ArrayBuffer,
) {
  const packed = packOrb(descriptors, keypoints);
  const sha256 = await orbHash(packed);
  const storageId = await ctx.storage.store(new Blob([packed], { type: ORB_CONTENT_TYPE }));
  return { storageId, sha256, keypointCount: descriptors.byteLength / DESCRIPTOR_BYTES };
}

export async function loadOrb(
  ctx: Pick<ActionCtx, "storage">,
  storageId: Id<"_storage">,
  count: number,
) {
  const file = await ctx.storage.get(storageId);
  if (!file) throw new ConvexError({ code: "orb_file_missing", storageId });
  if (
    !Number.isInteger(count) ||
    count < 0 ||
    count > MAX_KEYPOINTS ||
    file.size !== count * (DESCRIPTOR_BYTES + KEYPOINT_BYTES)
  ) {
    throw new ConvexError({ code: "bad_orb_file", storageId });
  }
  const packed = await file.arrayBuffer();
  const descriptors = packed.slice(0, count * DESCRIPTOR_BYTES);
  const keypoints = packed.slice(count * DESCRIPTOR_BYTES);
  decodeOrbFeatures(descriptors, keypoints);
  return { descriptors, keypoints };
}

export async function deleteOrbIfUnreferenced(ctx: MutationCtx, storageId: Id<"_storage">) {
  const descriptor = await ctx.db
    .query("descriptors")
    .withIndex("by_storageId", (q) => q.eq("storageId", storageId))
    .first();
  const contribution = await ctx.db
    .query("contributions")
    .withIndex("by_orbStorageId", (q) => q.eq("orbStorageId", storageId))
    .first();
  if (!descriptor && !contribution && (await ctx.db.system.get("_storage", storageId)))
    await ctx.storage.delete(storageId);
}
