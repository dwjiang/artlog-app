import { ConvexError, v } from "convex/values";

import { mutation } from "./_generated/server";
import { clearDocent } from "./docent";
import { requireDevice } from "./lib/auth";
import { limitDevice } from "./lib/rateLimits";

const MAX_MESSAGE_CHARS = 2000;
const MAX_CONTACT_CHARS = 200;

// Museums and estates can flag a fact from the card; the sheet is held for review and
// the cached sentences are dropped so a disputed fact never stays on screen.
export const correctFact = mutation({
  args: {
    artworkId: v.id("artworks"),
    factId: v.string(),
    message: v.string(),
    contact: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const device = await requireDevice(ctx);
    const artwork = await ctx.db.get(args.artworkId);
    if (!artwork) throw new ConvexError({ code: "artwork_not_found" });
    if (!artwork.factSheet?.some((fact) => fact.id === args.factId))
      throw new ConvexError({ code: "unknown_fact" });
    const message = args.message.trim();
    const contact = args.contact?.trim() || undefined;
    if (
      !message ||
      message.length > MAX_MESSAGE_CHARS ||
      (contact && contact.length > MAX_CONTACT_CHARS)
    ) {
      throw new ConvexError({ code: "invalid_correction" });
    }
    await limitDevice(ctx, "correctFact", device._id);
    await ctx.db.insert("factCorrections", {
      artworkId: artwork._id,
      factId: args.factId,
      message,
      contact,
      deviceId: device._id,
      createdAt: Date.now(),
      status: "open",
    });
    await ctx.db.patch(artwork._id, { factSheetNeedsReview: true });
    await clearDocent(ctx, artwork);
    return null;
  },
});
