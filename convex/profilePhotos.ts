"use node";

import { withErrorReporting } from "./lib/observability";
import { ConvexError, v, type Infer } from "convex/values";
import sharp from "sharp";
import { publicProfile, validateProfile } from "../shared/social/contracts";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action } from "./_generated/server";

export const save = action({
  args: {
    name: v.string(),
    bio: v.optional(v.string()),
    photo: v.optional(v.union(v.bytes(), v.null())),
  },
  returns: publicProfile,
  handler: async (ctx, input): Promise<Infer<typeof publicProfile>> =>
    withErrorReporting("profilePhotos.save", async () => {
      validateProfile(input);
      const profileId = await ctx.runQuery(
        internal.profilePhotoData.authorize,
        {},
      );
      let photo: Id<"_storage"> | null | undefined =
        input.photo === null ? null : undefined;
      if (input.photo) {
        if (input.photo.byteLength > 512 * 1024) {
          throw new ConvexError({ code: "invalid_profile_photo" });
        }
        let encoded: Buffer;
        try {
          encoded = await sharp(Buffer.from(input.photo), {
            limitInputPixels: 16_000_000,
            animated: false,
          })
            .rotate()
            .resize(256, 256, { fit: "cover" })
            .jpeg({ quality: 85 })
            .toBuffer();
        } catch {
          throw new ConvexError({ code: "invalid_profile_photo" });
        }
        photo = await ctx.storage.store(
          new Blob([new Uint8Array(encoded)], { type: "image/jpeg" }),
        );
      }
      try {
        return await ctx.runMutation(internal.profilePhotoData.save, {
          profileId,
          name: input.name,
          bio: input.bio,
          photo,
        });
      } catch (error) {
        if (photo) await ctx.storage.delete(photo);
        throw error;
      }
    }),
});
