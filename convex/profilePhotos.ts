"use node";

import { ConvexError, v, type Infer } from "convex/values";
import sharp from "sharp";

import { publicProfile, validateProfile } from "../shared/social/contracts";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action } from "./_generated/server";
import { fileStorage } from "./lib/fileStorage";
import { requireAllowedBio } from "./lib/moderation";
import { withErrorReporting } from "./lib/observability";

export const save = action({
  args: {
    name: v.string(),
    username: v.optional(v.string()),
    bio: v.optional(v.string()),
    photo: v.optional(v.union(v.bytes(), v.null())),
    avatar: v.optional(v.string()),
  },
  returns: publicProfile,
  handler: async (ctx, input): Promise<Infer<typeof publicProfile>> =>
    withErrorReporting("profilePhotos.save", async () => {
      validateProfile(input);
      const { profileId, bio, safetyChecks } = await ctx.runQuery(internal.profilePhotoData.authorize, {});
      // An unchanged bio was checked when it was saved, so it isn't sent again.
      if (input.bio !== undefined && input.bio.trim() !== (bio ?? "")) await requireAllowedBio(input.bio, safetyChecks);
      let photo: Id<"files"> | null | undefined = input.photo === null ? null : undefined;
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
        photo = await fileStorage.store(ctx, new Blob([new Uint8Array(encoded)], { type: "image/jpeg" }));
      }
      try {
        return await ctx.runMutation(internal.profilePhotoData.save, {
          profileId,
          name: input.name,
          username: input.username,
          bio: input.bio,
          photo,
          avatar: input.avatar,
        });
      } catch (error) {
        if (photo) await fileStorage.delete(ctx, photo);
        throw error;
      }
    }),
});
