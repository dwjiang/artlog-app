import { ConvexError, type Infer, v } from "convex/values";

import model from "../shared/model/model-version.json";
import { decodeOrbFeatures } from "../shared/orb/features";
import { internalAction, internalQuery } from "./_generated/server";
import { matchArtworkFromSearch } from "./identify";
import { queryPinecone, type SearchMeasurement } from "./lib/pinecone";
import { recognitionPartition } from "./lib/recognitionEligibility";
import { embedding, matchOutcome } from "./lib/validators";
import { searchRecordId } from "./lib/vectorSyncQueue";

const match = v.object({ id: v.string(), score: v.number() });
const outcome = v.object({
  outcome: matchOutcome,
  objectId: v.union(v.id("objects"), v.null()),
  probability: v.union(v.number(), v.null()),
});

export const corpusPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({
    records: v.array(
      v.object({
        id: v.string(),
        objectId: v.id("objects"),
        viewKey: v.optional(v.string()),
        partition: v.string(),
        ownerId: v.optional(v.id("museums")),
      }),
    ),
    cursor: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("vectors").withIndex("by_creation_time").paginate({ cursor, numItems: 256 });
    const records = await Promise.all(
      page.page.map(async (row) => ({
        id: searchRecordId(row),
        objectId: row.objectId,
        viewKey: row.viewKey,
        partition: row.partition,
        ownerId: (await ctx.db.get("objects", row.objectId))?.ownerId,
      })),
    );
    return { records, cursor: page.isDone ? null : page.continueCursor };
  },
});

const benchmarkResult = v.object({
  established: v.array(match),
  tentative: v.array(match),
  measurements: v.array(
    v.object({
      elapsedMs: v.number(),
      responseBytes: v.number(),
      readUnits: v.union(v.number(), v.null()),
      egressBytes: v.union(v.number(), v.null()),
    }),
  ),
  searchMs: v.number(),
  recognitionMs: v.union(v.number(), v.null()),
  pinecone: v.union(outcome, v.null()),
  exact: v.union(outcome, v.null()),
});

// Internal and read-only: runs the production hydration/ORB/calibrator path without creating scans.
export const run = internalAction({
  args: {
    vector: embedding,
    venueId: v.optional(v.id("museums")),
    orb: v.optional(v.object({ descriptors: v.bytes(), keypoints: v.bytes() })),
    exact: v.optional(v.object({ established: v.array(match), tentative: v.array(match) })),
  },
  returns: benchmarkResult,
  handler: async (ctx, args): Promise<Infer<typeof benchmarkResult>> => {
    if (args.exact && (args.exact.established.length > 32 || args.exact.tentative.length > 32)) {
      throw new ConvexError({ code: "bad_candidates" });
    }
    const started = performance.now();
    const measurements: SearchMeasurement[] = [];
    const search = async (partition: string) => {
      const matches = await queryPinecone(args.vector, partition, 32, (value) => measurements.push(value));
      return matches.filter((result) => result.id.endsWith(`:${partition}`));
    };
    const [established, tentative] = await Promise.all([
      search(recognitionPartition(model.modelVersion)),
      args.venueId ? search(recognitionPartition(model.modelVersion, args.venueId)) : [],
    ]);
    const searchMs = performance.now() - started;
    const summarize = (result: Awaited<ReturnType<typeof matchArtworkFromSearch>>) => ({
      outcome: result.decision.outcome,
      objectId: result.best?.objectId ?? null,
      probability: result.best?.probability ?? null,
    });
    if (!args.orb) {
      return { established, tentative, measurements, searchMs, recognitionMs: null, pinecone: null, exact: null };
    }
    const input = {
      vector: args.vector,
      modelVersion: model.modelVersion,
      venueId: args.venueId,
      query: decodeOrbFeatures(args.orb.descriptors, args.orb.keypoints),
    };
    const pinecone = summarize(await matchArtworkFromSearch(ctx, input, established, tentative));
    const recognitionMs = performance.now() - started;
    const exact = args.exact
      ? summarize(await matchArtworkFromSearch(ctx, input, args.exact.established, args.exact.tentative))
      : null;
    return { established, tentative, measurements, searchMs, recognitionMs, pinecone, exact };
  },
});
