import { ConvexError, type Infer, v } from "convex/values";

import { normalizeText } from "../shared/catalog/text";
import { sameOwner } from "../shared/journal/contracts";
import { LIMITS } from "../shared/journal/limits";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalQuery, query, type ActionCtx, type QueryCtx } from "./_generated/server";
import { docentStatusOf, scanDocentStatus } from "./docent";
import { internalMutation, mutation } from "./functions";
import { readArtworkContent } from "./lib/artworkContent";
import { requireDevice } from "./lib/auth";
import { findCorpusMatches, type CorpusMatch } from "./lib/corpusMatch";
import { fileStorage } from "./lib/fileStorage";
import { displayLabelFlow } from "./lib/labelVerify";
import { scheduleMatchFollowUps } from "./lib/matchFollowUps";
import { isSupported } from "./lib/modelVersion";
import { readObjectDetails } from "./lib/objectDetails";
import { withErrorReporting } from "./lib/observability";
import { ownerForDevice, requireJournalOwner } from "./lib/ownership";
import { eligibleObject } from "./lib/recognitionEligibility";
import { thumbnailShowsReference } from "./lib/thumbnailSource";
import {
  confirmedDisplay,
  confirmedFields,
  confirmedSource,
  embedding,
  embeddingArchive,
  docentSentence,
  docentStatus,
  factChip,
  toFactChip,
  labelFlowDisplay,
  rightsStatus,
  scanLink,
  snapshotFields,
  type ConfirmedFields,
  type ConfirmedSource,
} from "./lib/validators";
import { vectorHash, withVectorArchives } from "./lib/vectorStore";
import { dropLinkedView } from "./linkedViews";
import { deleteEmbedding, insertExpiringEmbedding, getEmbedding } from "./scanEmbeddings";
import schema from "./schema";

const scanFields = schema.tables.scans.validator.fields;
export const displayCandidate = snapshotFields.extend({
  objectId: v.id("objects"),
  artworkId: v.id("artworks"),
  // Absent on a work the owner named from a label or their details rather than recognition.
  probability: v.optional(v.number()),
  identityStatus: schema.tables.objects.validator.fields.identityStatus,
  rightsStatus,
  thumbnailUrl: v.optional(v.string()),
  // Where the thumbnail's letterboxed square lands in the scan's crop, in crop pixels: the verifier's corners, sent only
  // when its reference features came from the image the thumbnail shows, so the thumbnail's aspect places the painting.
  thumbnailCorners: v.optional(v.array(v.array(v.number()))),
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
  // Docent prose and its source chips come from the owner's confirmed details, else from a confident match's artwork.
  docent: v.optional(v.array(docentSentence)),
  docentStatus: v.optional(docentStatus),
  factSheet: v.optional(v.array(factChip)),
  rightNow: scanFields.rightNow,
  // The label flow is the owner's own state; the raw OCR reading stays server-side.
  labelFlow: v.optional(labelFlowDisplay),
  confirmed: v.optional(confirmedDisplay),
  // Set while `best` is the catalogue work the owner linked rather than recognition's guess.
  linked: v.optional(scanLink.pick("source")),
  error: scanFields.error,
});
export type ScanDisplay = Infer<typeof scanDisplay>;

const createArgs = {
  scope: v.optional(v.string()),
  deviceId: v.id("devices"),
  localId: v.string(),
  venueId: scanFields.venueId,
  visitId: scanFields.visitId,
  gallery: scanFields.gallery,
  modelVersion: v.string(),
  capturedAt: v.number(),
  cropCorners: scanFields.cropCorners,
};
const created = v.object({ scan: schema.doc("scans"), existing: v.boolean() });

async function prepareScan(ctx: QueryCtx, args: Infer<typeof vCreateArgs>) {
  const device = await ctx.db.get("devices", args.deviceId);
  if (!device || device.banned) throw new ConvexError({ code: "not_found" });
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
      || existing.modelVersion !== args.modelVersion
      || (await getEmbedding(ctx, existing.embeddingId)) === null);
  const visit = args.visitId ? await ctx.db.get("visits", args.visitId) : null;
  if (args.visitId && (!visit || !sameOwner(visit.owner, owner))) {
    throw new ConvexError({ code: "not_found" });
  }
  // New captures follow a moved visit; retries keep the context already used for this scan's recognition.
  const venueId = existing ? existing.venueId : (visit?.venueId ?? args.venueId);
  if (venueId && !(await ctx.db.get("museums", venueId))) {
    throw new ConvexError({ code: "invalid_venue" });
  }
  if (
    existing
    && (existing.visitId !== args.visitId
      || (!visit && existing.venueId !== args.venueId)
      || existing.capturedAt !== args.capturedAt)
  ) {
    throw new ConvexError({ code: "not_found" });
  }
  // Recognition reads the visit only while it is still at the scan's museum.
  return { existing, restart: !!restart, venueId, visit: visit?.venueId === venueId ? visit : null };
}
const vCreateArgs = v.object(createArgs);

const prepared = v.object({
  existing: v.union(schema.doc("scans"), v.null()),
  restart: v.boolean(),
  venueId: scanFields.venueId,
  visit: v.union(schema.doc("visits"), v.null()),
});

export const prepare = internalQuery({
  args: createArgs,
  returns: prepared,
  handler: prepareScan,
});

export const commit = internalMutation({
  args: { ...createArgs, archive: v.optional(embeddingArchive) },
  returns: created,
  handler: async (ctx, { archive, ...args }) => {
    const { existing, restart, venueId } = await prepareScan(ctx, args);
    if (existing && !restart) return { scan: existing, existing: true };
    if (isSupported(args.modelVersion) && !archive) throw new ConvexError({ code: "vector_archive_missing" });
    const now = Date.now();
    const { scope: _scope, ...scanArgs } = args;
    if (existing) await deleteEmbedding(ctx, existing.embeddingId);
    const embeddingId = archive ? await insertExpiringEmbedding(ctx, archive) : undefined;
    const fields = {
      ...scanArgs,
      venueId,
      embeddingId,
      generation: existing ? existing.generation + 1 : 0,
      status: "pending" as const,
      updatedAt: now,
    };
    const scanId = existing?._id ?? (await ctx.db.insert("scans", fields));
    if (existing) await ctx.db.replace("scans", scanId, fields);
    return { scan: (await ctx.db.get("scans", scanId))!, existing: false };
  },
});

type ScanContext = Pick<Infer<typeof prepared>, "venueId" | "visit">;

/**
 * Inserts or restarts the capture's scan. `alongside` starts once the capture has passed every check and runs while
 * the vector uploads; its result is dropped when another call created the scan first or the committed museum differs.
 */
export async function createScan<T>(
  ctx: ActionCtx,
  { vector, ...args }: Infer<typeof vCreateArgs> & { vector: number[] },
  alongside?: (context: ScanContext) => Promise<T>,
): Promise<Infer<typeof created> & { alongside?: T }> {
  const { existing, restart, venueId, visit } = await ctx.runQuery(internal.scans.prepare, args);
  if (existing && !restart) return { scan: existing, existing: true };
  if (!isSupported(args.modelVersion)) return ctx.runMutation(internal.scans.commit, args);
  const contentHash = await vectorHash(vector);
  const [stored, extra] = await Promise.allSettled([
    withVectorArchives(ctx, [{ vector }], ([archiveId]) =>
      ctx.runMutation(internal.scans.commit, {
        ...args,
        archive: { archiveId, contentHash },
      }),
    ),
    alongside?.({ venueId, visit }),
  ]);
  if (stored.status === "rejected") throw stored.reason;
  if (stored.value.existing || stored.value.scan.venueId !== venueId) return stored.value;
  if (extra.status === "rejected") throw extra.reason;
  return { ...stored.value, alongside: extra.value };
}

export const create = internalAction({
  args: { ...createArgs, vector: embedding },
  returns: created,
  handler: (ctx, args): Promise<Infer<typeof created>> =>
    withErrorReporting("scans.create", async () => {
      const { scan, existing } = await createScan(ctx, args);
      return { scan, existing };
    }),
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

type CandidateRef = Omit<NonNullable<Doc<"scans">["best"]>, "probability"> & { probability?: number };

export async function joinCandidate(
  ctx: QueryCtx,
  match: CandidateRef,
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
  const details = await readObjectDetails(ctx, object);
  const owner = object.ownerId ? await ctx.db.get("museums", object.ownerId) : null;
  // A hotlinked source image only for public-domain works; a contributor's consented crop always.
  const thumbnailUrl = details?.thumbnailStorageId
    ? await fileStorage.getUrl(ctx, details.thumbnailStorageId)
    : artwork.rightsStatus === "public_domain"
      ? details?.thumbnailUrl
      : undefined;
  const { corners, ...fields } = match;
  // A deduplicated object may borrow another image's thumbnail. Contributor references are already letterboxed.
  const fromThumbnail =
    !details?.thumbnailStorageId
    && typeof thumbnailUrl === "string"
    && details?.orb !== undefined
    && thumbnailShowsReference(thumbnailUrl, details.orb.extractedFrom);
  return {
    artwork,
    candidate: {
      ...fields,
      ...(corners && fromThumbnail ? { thumbnailCorners: corners } : {}),
      title: artwork.title,
      artist: artwork.artist,
      date: artwork.date,
      medium: details?.medium,
      institution: owner?.name,
      rightsStatus: artwork.rightsStatus,
      ...(thumbnailUrl ? { thumbnailUrl } : {}),
    },
  };
}

function catalogueCandidate(match: Pick<CorpusMatch, "objectId" | "artworkId">): CandidateRef {
  return { objectId: match.objectId, artworkId: match.artworkId, identityStatus: "established" };
}

async function displayScan(ctx: QueryCtx, scan: Doc<"scans">): Promise<ScanDisplay> {
  // A link that is no longer eligible falls back to recognition's own result.
  const linked = scan.linked ? await joinCandidate(ctx, catalogueCandidate(scan.linked), scan.venueId) : null;
  const [best, runnerUps] = await Promise.all([
    linked ?? (scan.best ? joinCandidate(ctx, scan.best, scan.venueId) : null),
    linked ? [] : Promise.all((scan.runnerUps ?? []).map((match) => joinCandidate(ctx, match, scan.venueId))),
  ]);
  const outcome = linked ? "confident" : scan.outcome;
  // Details confirmed before a link stay stored, with their docent generation, for when the owner returns to them.
  const confirmed = linked ? undefined : scan.confirmed;
  const prose =
    !confirmed && outcome === "confident" && best?.candidate.identityStatus === "established"
      ? best?.artwork
      : undefined;
  const content = prose ? await readArtworkContent(ctx, prose) : null;
  const factSheet = confirmed ? confirmed.factSheet : content?.factSheet;
  return {
    scanId: scan._id,
    localId: scan.localId,
    venueId: scan.venueId,
    visitId: scan.visitId,
    capturedAt: scan.capturedAt,
    status: scan.status,
    outcome,
    calibratorVersion: scan.calibratorVersion,
    best: best?.candidate,
    runnerUps: runnerUps.flatMap((joined) => (joined ? [joined.candidate] : [])),
    docent: confirmed ? confirmed.docent : content?.docent?.en,
    docentStatus: confirmed ? scanDocentStatus(confirmed) : prose && docentStatusOf(prose, content),
    factSheet: factSheet?.map(toFactChip),
    rightNow: scan.rightNow,
    labelFlow: scan.labelFlow && displayLabelFlow(scan.labelFlow),
    confirmed: confirmed && {
      source: confirmed.source,
      fields: confirmed.fields,
      confirmedAt: confirmed.confirmedAt,
    },
    linked: linked && scan.linked ? { source: scan.linked.source } : undefined,
    error: scan.error,
  };
}

function trimConfirmed(fields: ConfirmedFields): ConfirmedFields {
  const trimmed: ConfirmedFields = { title: fields.title.trim() };
  for (const name of ["artist", "date", "accession", "medium", "creditLine"] as const) {
    const value = fields[name]?.trim();
    if (value) trimmed[name] = value;
  }
  if (!trimmed.title || Object.values(trimmed).some((value) => (value ?? "").length > LIMITS.snapshot)) {
    throw new ConvexError({ code: "invalid_fields" });
  }
  return trimmed;
}

const namingFields = confirmedFields.pick("title", "artist", "date");
type NamingFields = Infer<typeof namingFields>;

function sameText(a: string | undefined, b: string | undefined): boolean {
  return normalizeText(a ?? "") === normalizeText(b ?? "");
}

// The label's Wikidata work stands only while the owner keeps the title and artist it was found from.
async function scanCorpusMatches(ctx: QueryCtx, scan: Doc<"scans">, fields: NamingFields): Promise<CorpusMatch[]> {
  const flow = scan.labelFlow;
  const wikidataId =
    flow?.stage === "verified"
    && flow.moderation === "clear"
    && sameText(flow.fields.title?.value, fields.title)
    && sameText(flow.fields.artist?.value, fields.artist)
      ? flow.wikidataId
      : undefined;
  return findCorpusMatches(ctx, { ...fields, wikidataId }, scan.venueId);
}

async function requireNamingScan(ctx: QueryCtx, scanId: Id<"scans">, source: ConfirmedSource): Promise<Doc<"scans">> {
  const device = await requireDevice(ctx);
  const scan = await ctx.db.get("scans", scanId);
  if (!scan || scan.deviceId !== device._id || scan.status === "pending") {
    throw new ConvexError({ code: "invalid_scan" });
  }
  if (source === "label" && (scan.labelFlow?.stage !== "verified" || scan.labelFlow.moderation !== "clear")) {
    throw new ConvexError({ code: "label_not_verified" });
  }
  return scan;
}

function sameFields(a: ConfirmedFields, b: ConfirmedFields): boolean {
  const names = ["title", "artist", "date", "accession", "medium", "creditLine"] as const;
  return names.every((name) => a[name] === b[name]);
}

// The owner names a work the index couldn't: from a verified label or typed by hand. Changed details
// start a new docent run; re-confirming the same details keeps the prose already written.
export const confirm = mutation({
  args: { scanId: v.id("scans"), source: confirmedSource, fields: confirmedFields },
  returns: v.null(),
  handler: async (ctx, { scanId, source, fields }) => {
    const scan = await requireNamingScan(ctx, scanId, source);
    const trimmed = trimConfirmed(fields);
    const previous = scan.confirmed;
    if (scan.linked) await dropLinkedView(ctx, scanId);
    if (previous?.source === source && sameFields(previous.fields, trimmed)) {
      if (scan.linked) await ctx.db.patch("scans", scanId, { linked: undefined });
      return null;
    }
    const generation = (previous?.generation ?? 0) + 1;
    // Research needs an artist to tell the work apart from others with the same title.
    const researchable = !!trimmed.artist;
    await ctx.db.patch("scans", scanId, {
      confirmed: {
        source,
        fields: trimmed,
        confirmedAt: Date.now(),
        generation,
        docentUnavailable: researchable ? undefined : true,
      },
      linked: undefined,
    });
    if (researchable) {
      await ctx.scheduler.runAfter(0, internal.docent.ensureForScan, { scanId, deviceId: scan.deviceId, generation });
    }
    return null;
  },
});

// Catalogue works the owner's details name, for an "Is it this?" pick before they confirm them as their own.
export const corpusMatches = query({
  args: { scanId: v.id("scans"), fields: namingFields },
  returns: v.array(displayCandidate),
  handler: async (ctx, { scanId, fields }) => {
    const device = await requireDevice(ctx);
    const scan = await ctx.db.get("scans", scanId);
    const title = fields.title.trim();
    if (
      !scan
      || scan.deviceId !== device._id
      || scan.status === "pending"
      || !title
      || Object.values(fields).some((value) => (value ?? "").length > LIMITS.snapshot)
    ) {
      return [];
    }
    const matches = await scanCorpusMatches(ctx, scan, {
      title,
      artist: fields.artist?.trim() || undefined,
      date: fields.date?.trim() || undefined,
    });
    const joined = await Promise.all(
      matches.map((match) => joinCandidate(ctx, catalogueCandidate(match), scan.venueId)),
    );
    return joined.flatMap((entry) => (entry ? [entry.candidate] : []));
  },
});

// The owner's pick from corpusMatches: the scan now names that catalogue work, as a recognised match would.
export const link = mutation({
  args: { scanId: v.id("scans"), objectId: v.id("objects"), source: confirmedSource, fields: confirmedFields },
  returns: v.null(),
  handler: async (ctx, { scanId, objectId, source, fields }) => {
    const scan = await requireNamingScan(ctx, scanId, source);
    const { title, artist, date } = trimConfirmed(fields);
    const match = (await scanCorpusMatches(ctx, scan, { title, artist, date })).find(
      (candidate) => candidate.objectId === objectId,
    );
    if (!match) throw new ConvexError({ code: "invalid_object" });
    if (scan.linked?.objectId === objectId && scan.linked.source === source) return null;
    await dropLinkedView(ctx, scanId);
    await ctx.db.patch("scans", scanId, {
      linked: { source, objectId, artworkId: match.artworkId, linkedAt: Date.now() },
      rightNow: undefined,
    });
    const artwork = await ctx.db.get("artworks", match.artworkId);
    if (artwork) await scheduleMatchFollowUps(ctx, scan, artwork);
    return null;
  },
});

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
