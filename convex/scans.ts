import { ConvexError, type Infer, v } from "convex/values";

import { sameOwner } from "../shared/journal/contracts";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery, query, type QueryCtx } from "./_generated/server";
import { requireDevice } from "./lib/auth";
import { displayLabelFlow } from "./lib/labelVerify";
import { isSupported } from "./lib/modelVersion";
import { ownerForDevice, requireJournalOwner } from "./lib/ownership";
import { eligibleObject } from "./lib/recognitionEligibility";
import { embedding, docentSentence, factChip, labelFlowDisplay, rightsStatus, snapshotFields } from "./lib/validators";
import { deleteEmbedding } from "./scanEmbeddings";
import schema from "./schema";

const scanFields = schema.tables.scans.validator.fields;
export const displayCandidate = snapshotFields.extend({
  objectId: v.id("objects"),
  artworkId: v.id("artworks"),
  probability: v.number(),
  identityStatus: schema.tables.objects.validator.fields.identityStatus,
  rightsStatus,
  thumbnailUrl: v.optional(v.string()),
  gallery: v.optional(v.string()),
});

export const scanDisplay = v.object({
  scanId: v.id("scans"),
  localId: v.string(),
  venueId: scanFields.venueId,
  visitId: scanFields.visitId,
  capturedAt: v.number(),
  status: scanFields.status,
  outcome: scanFields.outcome,
  calibratorVersion: scanFields.calibratorVersion,
  best: v.optional(displayCandidate),
  runnerUps: v.optional(v.array(displayCandidate)),
  // Docent prose and its source chips come from the artwork; only a confident card shows them.
  docent: v.optional(v.array(docentSentence)),
  factSheet: v.optional(v.array(factChip)),
  rightNow: scanFields.rightNow,
  // The label flow and museum-site search are the owner's own state; the raw OCR reading stays server-side.
  labelFlow: v.optional(labelFlowDisplay),
  museumSearch: scanFields.museumSearch,
  error: scanFields.error,
});
export type ScanDisplay = Infer<typeof scanDisplay>;

export const create = internalMutation({
  args: {
    scope: v.optional(v.string()),
    deviceId: v.id("devices"),
    localId: v.string(),
    venueId: scanFields.venueId,
    visitId: scanFields.visitId,
    gallery: scanFields.gallery,
    modelVersion: v.string(),
    vector: embedding,
    capturedAt: v.number(),
  },
  returns: v.object({ scan: schema.doc("scans"), existing: v.boolean() }),
  handler: async (ctx, args) => {
    const device = await ctx.db.get("devices", args.deviceId);
    if (!device) throw new ConvexError({ code: "not_found" });
    if (args.scope !== undefined) await requireJournalOwner(ctx, args.scope);
    const owner = await ownerForDevice(ctx, device);
    const existing = await ctx.db
      .query("scans")
      .withIndex("by_device_localId", (q) => q.eq("deviceId", args.deviceId).eq("localId", args.localId))
      .unique();
    const restart =
      existing
      && existing.status !== "identified"
      && isSupported(args.modelVersion)
      && (existing.status === "unsupported_version"
        || existing.status === "failed"
        || existing.modelVersion !== args.modelVersion);
    if (args.visitId) {
      const visit = await ctx.db.get("visits", args.visitId);
      if (!visit || !sameOwner(visit.owner, owner) || visit.venueId !== args.venueId) {
        throw new ConvexError({ code: "not_found" });
      }
    }
    if (args.venueId && !(await ctx.db.get("museums", args.venueId))) {
      throw new ConvexError({ code: "invalid_venue" });
    }
    if (
      existing
      && (existing.visitId !== args.visitId
        || existing.venueId !== args.venueId
        || existing.capturedAt !== args.capturedAt)
    ) {
      throw new ConvexError({ code: "not_found" });
    }
    if (existing && !restart) return { scan: existing, existing: true };
    const now = Date.now();
    const { scope: _scope, vector, ...scanArgs } = args;
    if (existing) await deleteEmbedding(ctx, existing.embeddingId);
    const embeddingId = await ctx.db.insert("scanEmbeddings", { vector });
    const fields = {
      ...scanArgs,
      embeddingId,
      generation: existing ? existing.generation + 1 : 0,
      status: "pending" as const,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    const scanId = existing?._id ?? (await ctx.db.insert("scans", fields));
    if (existing) await ctx.db.replace("scans", scanId, fields);
    const scan = await ctx.db.get("scans", scanId);
    if (!scan) throw new ConvexError({ code: "scan_not_found" });
    return { scan, existing: false };
  },
});

export const setResult = internalMutation({
  args: {
    scanId: v.id("scans"),
    generation: v.number(),
    status: scanFields.status,
    outcome: scanFields.outcome,
    best: scanFields.best,
    runnerUps: scanFields.runnerUps,
    candidateSignals: scanFields.candidateSignals,
    calibratorVersion: v.string(),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const scan = await ctx.db.get("scans", args.scanId);
    if (!scan) throw new ConvexError({ code: "scan_not_found" });
    if (scan.generation !== args.generation || scan.status !== "pending") {
      return null;
    }
    const device = await ctx.db.get("devices", scan.deviceId);
    if (!device || device.banned) return null;
    const valid = async (match: NonNullable<typeof args.best>) => {
      const object = await ctx.db.get("objects", match.objectId);
      return (
        !!object && object.identityStatus === match.identityStatus && (await eligibleObject(ctx, object, scan.venueId))
      );
    };
    const best = args.best && (await valid(args.best)) ? args.best : undefined;
    const runnerUps = [];
    for (const candidate of args.runnerUps ?? []) {
      if (await valid(candidate)) runnerUps.push(candidate);
    }
    const outcome = !best
      ? "miss"
      : best.identityStatus === "tentative" && args.outcome === "confident"
        ? "soft"
        : args.outcome;
    await ctx.db.patch("scans", scan._id, {
      status: args.status,
      outcome,
      best,
      runnerUps,
      candidateSignals: args.candidateSignals,
      calibratorVersion: args.calibratorVersion,
      error: args.error,
      updatedAt: Date.now(),
    });
    if (outcome === "confident" && scan.visitId && args.best?.gallery !== undefined) {
      const visit = await ctx.db.get("visits", scan.visitId);
      const device = await ctx.db.get("devices", scan.deviceId);
      if (
        visit
        && device
        && sameOwner(visit.owner, await ownerForDevice(ctx, device))
        && visit.venueId === scan.venueId
        && (visit.lastConfidentAt === undefined || scan.capturedAt >= visit.lastConfidentAt)
      ) {
        await ctx.db.patch("visits", visit._id, {
          lastConfidentGallery: args.best.gallery,
          lastConfidentAt: scan.capturedAt,
        });
      }
    }
    return null;
  },
});

export async function joinCandidate(
  ctx: QueryCtx,
  match: NonNullable<Doc<"scans">["best"]>,
  venueId?: Doc<"scans">["venueId"],
): Promise<{
  candidate: Infer<typeof displayCandidate>;
  artwork: Doc<"artworks">;
} | null> {
  const [object, artwork] = await Promise.all([
    ctx.db.get("objects", match.objectId),
    ctx.db.get("artworks", match.artworkId),
  ]);
  if (!object || !artwork || !(await eligibleObject(ctx, object, venueId))) {
    return null;
  }
  const owner = object.ownerId ? await ctx.db.get("museums", object.ownerId) : null;
  // A hotlinked source image only for public-domain works; a contributor's consented crop always.
  const thumbnailUrl = object.thumbnailStorageId
    ? await ctx.storage.getUrl(object.thumbnailStorageId)
    : artwork.rightsStatus === "public_domain"
      ? object.thumbnailUrl
      : undefined;
  // The verifier's projected corners stay on the scan as evidence; the card no longer draws them.
  const { corners, ...fields } = match;
  return {
    artwork,
    candidate: {
      ...fields,
      title: artwork.title,
      artist: artwork.artist,
      date: artwork.date,
      medium: object.medium,
      institution: owner?.name,
      rightsStatus: artwork.rightsStatus,
      ...(thumbnailUrl ? { thumbnailUrl } : {}),
    },
  };
}

async function displayScan(ctx: QueryCtx, scan: Doc<"scans">): Promise<ScanDisplay> {
  const [best, runnerUps] = await Promise.all([
    scan.best ? joinCandidate(ctx, scan.best, scan.venueId) : null,
    Promise.all((scan.runnerUps ?? []).map((match) => joinCandidate(ctx, match, scan.venueId))),
  ]);
  const prose =
    scan.outcome === "confident" && best?.candidate.identityStatus === "established" ? best?.artwork : undefined;
  return {
    scanId: scan._id,
    localId: scan.localId,
    venueId: scan.venueId,
    visitId: scan.visitId,
    capturedAt: scan.capturedAt,
    status: scan.status,
    outcome: scan.outcome,
    calibratorVersion: scan.calibratorVersion,
    best: best?.candidate,
    runnerUps: runnerUps.flatMap((joined) => (joined ? [joined.candidate] : [])),
    docent: prose?.docent?.en,
    factSheet: prose?.factSheet?.map(({ id, sourceUrl, sourceLabel }) => ({
      id,
      sourceUrl,
      sourceLabel,
    })),
    rightNow: scan.rightNow,
    labelFlow: scan.labelFlow && displayLabelFlow(scan.labelFlow),
    museumSearch: scan.museumSearch,
    error: scan.error,
  };
}

export const get = query({
  args: { scanId: v.id("scans") },
  returns: v.union(scanDisplay, v.null()),
  handler: async (ctx, { scanId }) => {
    const device = await requireDevice(ctx);
    const scan = await ctx.db.get("scans", scanId);
    return scan?.deviceId === device._id ? displayScan(ctx, scan) : null;
  },
});

export const getStored = internalQuery({
  args: { scanId: v.id("scans") },
  returns: v.union(schema.doc("scans"), v.null()),
  handler: (ctx, { scanId }) => ctx.db.get("scans", scanId),
});

export const getDisplay = internalQuery({
  args: { scanId: v.id("scans"), deviceId: v.id("devices") },
  returns: scanDisplay,
  handler: async (ctx, { scanId, deviceId }) => {
    const scan = await ctx.db.get("scans", scanId);
    if (!scan || scan.deviceId !== deviceId) {
      throw new ConvexError({ code: "scan_not_found" });
    }
    return displayScan(ctx, scan);
  },
});
