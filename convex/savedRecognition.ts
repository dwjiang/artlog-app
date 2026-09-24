import { ConvexError, v, type Infer } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalMutation, internalQuery, mutation } from "./_generated/server";
import schema from "./schema";
import { decodeQuery, matchArtwork } from "./identify";
import { displayCandidate, joinCandidate } from "./scans";
import { requireDeviceFromAction } from "./lib/auth";
import { requireJournalOwner, requireOwnedSave, nextChangeVersion } from "./lib/ownership";
import { findSavedRecognition } from "./lib/savedRecognition";
import { isSupported, validateVector } from "./lib/modelVersion";
import { deleteOrbIfUnreferenced, loadOrb, storeOrb } from "./lib/orbStorage";
import { withErrorReporting } from "./lib/observability";
import { limitDevice } from "./lib/rateLimits";
import { recordArtworkScore } from "./lib/leaderboard";
import { embedding } from "./lib/validators";

const savedArgs = { scope: v.string(), localId: v.string() };
const result = v.object({
  attempt: v.number(),
  outcome: v.union(v.literal("confident"), v.literal("soft"), v.literal("miss")),
  candidates: v.array(displayCandidate),
});
export type SavedRecognitionResult = Infer<typeof result>;

export const target = internalQuery({
  args: savedArgs,
  returns: v.boolean(),
  handler: async (ctx, { scope, localId }) => {
    const { owner } = await requireJournalOwner(ctx, scope);
    const save = await requireOwnedSave(ctx, owner, localId);
    return !!(await findSavedRecognition(ctx, save._id));
  },
});

export const attach = internalMutation({
  args: {
    ...savedArgs,
    sourceLocalId: v.string(),
    vector: embedding,
    modelVersion: v.string(),
    orbStorageId: v.id("_storage"),
    keypointCount: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { scope, localId, ...payload }) => {
    const { owner } = await requireJournalOwner(ctx, scope);
    const save = await requireOwnedSave(ctx, owner, localId);
    if (!(await findSavedRecognition(ctx, save._id))) {
      await ctx.db.insert("savedRecognition", { ...payload, saveId: save._id, attempt: 0, candidateIds: [] });
    }
    await deleteOrbIfUnreferenced(ctx, payload.orbStorageId);
    return null;
  },
});

export const discard = internalMutation({
  args: { storageId: v.id("_storage") },
  returns: v.null(),
  handler: async (ctx, { storageId }) => {
    await deleteOrbIfUnreferenced(ctx, storageId);
    return null;
  },
});

export const upload = action({
  args: {
    ...savedArgs,
    sourceLocalId: v.string(),
    vector: embedding,
    modelVersion: v.string(),
    descriptors: v.bytes(),
    keypoints: v.bytes(),
  },
  returns: v.null(),
  handler: (ctx, args) =>
    withErrorReporting("savedRecognition.upload", async () => {
      const device = await requireDeviceFromAction(ctx);
      const saved = { scope: args.scope, localId: args.localId };
      if (await ctx.runQuery(internal.savedRecognition.target, saved)) return null;
      await limitDevice(ctx, "recognitionUpload", device._id);
      validateVector(args.vector);
      decodeQuery(args.descriptors, args.keypoints);
      if (!args.modelVersion || args.modelVersion.length > 100 || args.sourceLocalId.length > 100) {
        throw new ConvexError({ code: "bad_features" });
      }
      const orb = await storeOrb(ctx, args.descriptors, args.keypoints);
      try {
        await ctx.runMutation(internal.savedRecognition.attach, {
          ...saved,
          sourceLocalId: args.sourceLocalId,
          modelVersion: args.modelVersion,
          vector: args.vector,
          orbStorageId: orb.storageId,
          keypointCount: orb.keypointCount,
        });
      } finally {
        await ctx.runMutation(internal.savedRecognition.discard, { storageId: orb.storageId });
      }
      return null;
    }),
});

export const begin = internalMutation({
  args: savedArgs,
  returns: v.object({ data: schema.doc("savedRecognition"), venueId: v.optional(v.id("museums")) }),
  handler: async (ctx, { scope, localId }) => {
    const { owner } = await requireJournalOwner(ctx, scope);
    const save = await requireOwnedSave(ctx, owner, localId);
    const data = await findSavedRecognition(ctx, save._id);
    if (!data) throw new ConvexError({ code: "recognition_unavailable" });
    if (!isSupported(data.modelVersion)) throw new ConvexError({ code: "recognition_model_retired" });
    const fields = { attempt: data.attempt + 1, saveUpdatedAt: save.updatedAt, candidateIds: [] };
    await ctx.db.patch(data._id, fields);
    return { data: { ...data, ...fields }, venueId: save.venueId };
  },
});

export const finish = internalMutation({
  args: {
    ...savedArgs,
    attempt: v.number(),
    outcome: result.fields.outcome,
    matches: v.array(v.object(schema.tables.scans.validator.fields.best.fields)),
  },
  returns: result,
  handler: async (ctx, { scope, localId, attempt, outcome, matches }): Promise<SavedRecognitionResult> => {
    const { owner } = await requireJournalOwner(ctx, scope);
    const save = await requireOwnedSave(ctx, owner, localId);
    const data = await findSavedRecognition(ctx, save._id);
    if (!data || data.attempt !== attempt) throw new ConvexError({ code: "search_superseded" });
    const candidates = [];
    for (const match of matches.slice(0, 6)) {
      const joined = await joinCandidate(ctx, match, save.venueId);
      if (joined) candidates.push(joined.candidate);
    }
    await ctx.db.patch(data._id, { candidateIds: candidates.map((candidate) => candidate.objectId) });
    return { attempt, outcome: candidates.length ? outcome : "miss", candidates };
  },
});

export const identify = action({
  args: savedArgs,
  returns: result,
  handler: (ctx, args): Promise<SavedRecognitionResult> =>
    withErrorReporting("savedRecognition.identify", async () => {
      const device = await requireDeviceFromAction(ctx);
      await limitDevice(ctx, "identify", device._id);
      const { data, venueId } = await ctx.runMutation(internal.savedRecognition.begin, args);
      const orb = await loadOrb(ctx, data.orbStorageId, data.keypointCount);
      const { decision, best } = await matchArtwork(ctx, {
        vector: data.vector,
        modelVersion: data.modelVersion,
        venueId,
        query: decodeQuery(orb.descriptors, orb.keypoints),
      });
      return ctx.runMutation(internal.savedRecognition.finish, {
        ...args,
        attempt: data.attempt,
        outcome: decision.outcome,
        matches: [
          ...(best ? [best] : []),
          ...decision.runnerUps.map(({ candidate, probability }) => ({
            objectId: candidate.object._id,
            artworkId: candidate.artwork._id,
            identityStatus: candidate.object.identityStatus,
            probability,
          })),
        ],
      });
    }),
});

export const accept = mutation({
  args: { ...savedArgs, attempt: v.number(), objectId: v.id("objects") },
  returns: schema.doc("collections"),
  handler: (ctx, { scope, localId, attempt, objectId }) =>
    withErrorReporting("savedRecognition.accept", async () => {
      const { owner, device } = await requireJournalOwner(ctx, scope);
      const save = await requireOwnedSave(ctx, owner, localId);
      const data = await findSavedRecognition(ctx, save._id);
      if (!data || data.attempt !== attempt || !data.candidateIds.includes(objectId)) {
        throw new ConvexError({ code: "unknown_candidate" });
      }
      if (save.updatedAt !== data.saveUpdatedAt) throw new ConvexError({ code: "saved_artwork_changed" });
      const object = await ctx.db.get(objectId);
      const joined =
        object
        && (await joinCandidate(
          ctx,
          { objectId, artworkId: object.artworkId, identityStatus: object.identityStatus, probability: 0 },
          save.venueId,
        ));
      if (!joined) throw new ConvexError({ code: "unknown_candidate" });
      const { title, artist, date, medium, institution, artworkId } = joined.candidate;
      await ctx.db.patch(save._id, {
        objectId,
        artworkId,
        snapshot: { title, artist, date, medium, institution },
        updatedAt: Math.max(Date.now(), save.updatedAt + 1),
        updatedBy: device._id,
        changeVersion: await nextChangeVersion(ctx, owner),
      });
      const updated = (await ctx.db.get(save._id))!;
      // Artwork scoring assumes a live save keeps its artwork, so score the change as a removal plus a new save.
      await recordArtworkScore(ctx, owner, { ...save, deletedAt: Date.now() }, save);
      await recordArtworkScore(ctx, owner, updated);
      return updated;
    }),
});
