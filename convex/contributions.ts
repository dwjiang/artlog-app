import { ConvexError, type Infer, v } from 'convex/values';

import { contributionPayload } from '../shared/attested-payloads';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { action, internalMutation, internalQuery, mutation, query, type MutationCtx } from './_generated/server';
import { requireAttestedWrite } from './devices';
import { decodeQuery } from './identify';
import { bumpCounter } from './ingest';
import { REPLAY_COSINE } from './lib/agreement';
import { requireDevice, requireDeviceFromAction } from './lib/auth';
import { cosine } from './lib/cosine';
import { FIELD_NAMES } from './lib/labelVerify';
import { limitDevice } from './lib/rateLimits';
import {
  contributionRejectedReason,
  type ContributionField,
  type EvidenceKind,
  type LabelFieldName,
  type LabelFlow,
} from './lib/validators';
import schema from './schema';
import { beginRevert } from './revert';

// Design §8: a vector this close to an indexed work, or to the device's own earlier contribution, is a replay.
export const DUPLICATE_COSINE = 0.995;
// The phone resizes the consented crop to ≤ 256 px JPEG (05.03); anything larger is not a crop.
export const MAX_CROP_BYTES = 200 * 1024;
const CROP_CONTENT_TYPE = 'image/jpeg';
const MAX_LISTED = 200;
const DUPLICATE_PAGE_SIZE = 64;
const DUPLICATE_PAGE_BYTES = 1024 * 1024;
const MAX_COMMIT_ATTEMPTS = 3;

const contributionFields = schema.tables.contributions.validator.fields;
const submittedField = v.object({ value: v.string(), edited: v.boolean() });
const submittedFields = v.object({
  title: submittedField, artist: submittedField, date: v.optional(submittedField),
  medium: v.optional(submittedField), accession: v.optional(submittedField), creditLine: v.optional(submittedField),
});
type SubmittedFields = typeof submittedFields.type;
type ContributionFields = Doc<'contributions'>['fields'];

const contributionResult = v.object({
  contributionId: v.id('contributions'),
  status: contributionFields.status,
  reason: v.optional(contributionRejectedReason),
});
type ContributionResult = Infer<typeof contributionResult>;

const contributionSummary = v.object({
  contributionId: v.id('contributions'), status: contributionFields.status, rejectedReason: contributionFields.rejectedReason,
  venueId: contributionFields.venueId, scanId: contributionFields.scanId, fields: contributionFields.fields,
  evidence: contributionFields.evidence, wikidataId: contributionFields.wikidataId,
  promotedObjectId: contributionFields.promotedObjectId, createdAt: contributionFields.createdAt,
});

export const requestCropUpload = mutation({
  args: {},
  returns: v.object({ uploadUrl: v.string() }),
  handler: async (ctx) => {
    const device = await requireDevice(ctx);
    await limitDevice(ctx, 'contribute', device._id);
    return { uploadUrl: await ctx.storage.generateUploadUrl() };
  },
});

// Values must be the ones the label flow verified and moderated; the flag can only weaken a field's evidence.
function resolveField(flow: LabelFlow, name: LabelFieldName, input: { value: string; edited: boolean }): ContributionField {
  const verified = flow.fields[name];
  if (!verified || verified.value !== input.value.trim()) throw new ConvexError({ code: 'field_mismatch', field: name });
  return { value: verified.value, edited: input.edited, evidence: input.edited ? 'user_edited' : verified.evidence };
}

function resolveFields(flow: LabelFlow, submitted: SubmittedFields): ContributionFields {
  const fields: ContributionFields = {
    title: resolveField(flow, 'title', submitted.title), artist: resolveField(flow, 'artist', submitted.artist),
  };
  for (const name of FIELD_NAMES) {
    const input = submitted[name];
    if (input && name !== 'title' && name !== 'artist') fields[name] = resolveField(flow, name, input);
  }
  return fields;
}

function evidenceOf(fields: ContributionFields): EvidenceKind[] {
  return [...new Set(FIELD_NAMES.flatMap((name) => fields[name] ? [fields[name].evidence] : []))];
}

const duplicatePage = v.object({ duplicate: v.boolean(), cursor: v.union(v.string(), v.null()) });
type DuplicatePage = Infer<typeof duplicatePage>;

export const checkDuplicatePage = internalQuery({
  args: { scanId: v.id('scans'), generation: v.number(), cursor: v.union(v.string(), v.null()) },
  returns: duplicatePage,
  handler: async (ctx, { scanId, generation, cursor }): Promise<DuplicatePage> => {
    const device = await requireDevice(ctx);
    const scan = await ctx.db.get(scanId);
    if (!scan || scan.deviceId !== device._id || !scan.venueId) throw new ConvexError({ code: 'invalid_scan' });
    if (scan.generation !== generation) throw new ConvexError({ code: 'scan_restarted' });
    const page = await ctx.db.query('contributions')
      .withIndex('by_device_venue_model', (q) =>
        q.eq('deviceId', device._id).eq('venueId', scan.venueId!).eq('modelVersion', scan.modelVersion))
      .paginate({ cursor, numItems: DUPLICATE_PAGE_SIZE, maximumBytesRead: DUPLICATE_PAGE_BYTES });
    return {
      duplicate: page.page.some((row) => row.status !== 'rejected' && cosine(row.vector, scan.vector) >= DUPLICATE_COSINE),
      cursor: page.isDone ? null : page.continueCursor,
    };
  },
});

async function deleteUnreferencedCrop(ctx: MutationCtx, cropStorageId: Id<'_storage'>): Promise<void> {
  const crop = await ctx.db.system.get('_storage', cropStorageId);
  if (!crop || crop.contentType !== CROP_CONTENT_TYPE || crop.size > MAX_CROP_BYTES) return;
  const reference = await ctx.db.query('contributions')
    .withIndex('by_cropStorageId', (q) => q.eq('cropStorageId', cropStorageId)).first();
  if (!reference) await ctx.storage.delete(cropStorageId);
}

async function validateSubmission(
  ctx: MutationCtx, scan: Doc<'scans'>, submitted: SubmittedFields, cropStorageId: Id<'_storage'>,
): Promise<{ flow: LabelFlow; fields: ContributionFields }> {
  const flow = scan.labelFlow;
  if (!flow || flow.stage !== 'verified' || flow.moderation === 'flagged') throw new ConvexError({ code: 'label_unverified' });
  const fields = resolveFields(flow, submitted);
  const crop = await ctx.db.system.get('_storage', cropStorageId);
  if (!crop || crop.contentType !== CROP_CONTENT_TYPE || crop.size > MAX_CROP_BYTES) throw new ConvexError({ code: 'bad_crop' });
  return { flow, fields };
}

const authorizationResult = v.union(
  v.object({ kind: v.literal('existing'), result: contributionResult }),
  v.object({
    kind: v.literal('authorized'), scan: schema.doc('scans'),
    previousContributionId: v.union(v.id('contributions'), v.null()),
  }),
);

export const authorize = internalMutation({
  args: {
    scanId: v.id('scans'), fields: submittedFields, cropStorageId: v.id('_storage'),
    nonce: v.string(), assertionBase64: v.string(),
  },
  returns: authorizationResult,
  handler: async (ctx, args): Promise<Infer<typeof authorizationResult>> => {
    const { scanId, cropStorageId } = args;
    const device = await requireAttestedWrite(ctx, {
      ...args, payload: contributionPayload({ scanId, cropStorageId, fields: args.fields }),
    });
    const scan = await ctx.db.get(scanId);
    if (!scan || scan.deviceId !== device._id || !scan.venueId) throw new ConvexError({ code: 'invalid_scan' });
    const existing = await ctx.db.query('contributions').withIndex('by_scanId', (q) => q.eq('scanId', scanId)).unique();
    if (existing) {
      if (existing.cropStorageId !== cropStorageId) await deleteUnreferencedCrop(ctx, cropStorageId);
      return { kind: 'existing', result: { contributionId: existing._id, status: existing.status, reason: existing.rejectedReason } };
    }
    await validateSubmission(ctx, scan, args.fields, cropStorageId);
    // This transaction commits the charge and assertion before any search, including searches that fail.
    await limitDevice(ctx, 'contribute', device._id);
    return { kind: 'authorized', scan, previousContributionId: device.lastContributionId ?? null };
  },
});

export const commit = internalMutation({
  args: {
    scanId: v.id('scans'), generation: v.number(), descriptors: v.bytes(), keypoints: v.bytes(), keypointCount: v.number(),
    fields: submittedFields, cropStorageId: v.id('_storage'), duplicate: v.boolean(),
    previousContributionId: v.union(v.id('contributions'), v.null()),
  },
  returns: contributionResult,
  handler: async (ctx, args): Promise<ContributionResult> => {
    const { scanId, cropStorageId } = args;
    const device = await requireDevice(ctx);
    const scan = await ctx.db.get(scanId);
    if (!scan || scan.deviceId !== device._id || !scan.venueId) throw new ConvexError({ code: 'invalid_scan' });
    if (scan.generation !== args.generation) throw new ConvexError({ code: 'scan_restarted' });
    const existing = await ctx.db.query('contributions').withIndex('by_scanId', (q) => q.eq('scanId', scanId)).unique();
    if (existing) {
      if (existing.cropStorageId !== cropStorageId) await deleteUnreferencedCrop(ctx, cropStorageId);
      return { contributionId: existing._id, status: existing.status, reason: existing.rejectedReason };
    }
    // Paginated queries span transactions; repeat the check if another submission committed meanwhile.
    if ((device.lastContributionId ?? null) !== args.previousContributionId) {
      throw new ConvexError({ code: 'contributions_changed' });
    }
    const { flow, fields } = await validateSubmission(ctx, scan, args.fields, cropStorageId);
    const duplicate = args.duplicate;
    if (duplicate) await deleteUnreferencedCrop(ctx, cropStorageId);
    const contributionId = await ctx.db.insert('contributions', {
      deviceId: device._id, venueId: scan.venueId, scanId, vector: scan.vector, modelVersion: scan.modelVersion,
      descriptors: args.descriptors, keypoints: args.keypoints, keypointCount: args.keypointCount,
      cropStorageId: duplicate ? undefined : cropStorageId, rawOcr: flow.rawOcr, fields, evidence: evidenceOf(fields),
      sourceUrl: flow.sourceUrl,
      // A Wikidata match identifies the title/artist pair; an edit to either breaks that binding.
      wikidataId: fields.title.edited || fields.artist.edited ? undefined : flow.wikidataId,
      status: duplicate ? 'rejected' : 'private', rejectedReason: duplicate ? 'duplicate' : undefined, createdAt: Date.now(),
    });
    await ctx.db.patch(device._id, { lastContributionId: contributionId });
    return duplicate ? { contributionId, status: 'rejected', reason: 'duplicate' } : { contributionId, status: 'private' };
  },
});

export const contribute = action({
  args: {
    scanId: v.id('scans'), descriptors: v.bytes(), keypoints: v.bytes(), fields: submittedFields,
    cropStorageId: v.id('_storage'), consent: v.literal(true), nonce: v.string(), assertionBase64: v.string(),
  },
  returns: contributionResult,
  handler: async (ctx, { consent: _consent, ...args }): Promise<ContributionResult> => {
    const keypointCount = decodeQuery(args.descriptors, args.keypoints).count;
    const { nonce, assertionBase64, ...submission } = args;
    const authorization = await ctx.runMutation(internal.contributions.authorize, {
      scanId: args.scanId, cropStorageId: args.cropStorageId, fields: args.fields, nonce, assertionBase64,
    });
    if (authorization.kind === 'existing') return authorization.result;
    const { scan } = authorization;
    let previousContributionId = authorization.previousContributionId;
    const matches = await ctx.vectorSearch('vectors', 'by_vector', {
      vector: scan.vector, limit: 3, filter: (q) => q.eq('modelVersion', scan.modelVersion),
    });
    for (let attempt = 0; attempt < MAX_COMMIT_ATTEMPTS; attempt++) {
      let duplicate = matches.some((match) => match._score >= DUPLICATE_COSINE);
      let cursor: string | null = null;
      do {
        if (duplicate) break;
        const page: DuplicatePage = await ctx.runQuery(internal.contributions.checkDuplicatePage, {
          scanId: scan._id, generation: scan.generation, cursor,
        });
        duplicate = page.duplicate;
        cursor = page.cursor;
      } while (cursor !== null);
      try {
        return await ctx.runMutation(internal.contributions.commit, {
          ...submission, generation: scan.generation, keypointCount, duplicate, previousContributionId,
        });
      } catch (error) {
        if (!(error instanceof ConvexError) || error.data.code !== 'contributions_changed') throw error;
        previousContributionId = (await requireDeviceFromAction(ctx)).lastContributionId ?? null;
      }
    }
    throw new ConvexError({ code: 'contribution_busy' });
  },
});

// Backers are read one at a time and only until the first live one: each carries a vector and ORB
// features, so a popular work's full set does not fit one transaction (see promotion's partner batches).
async function otherBacker(
  ctx: MutationCtx, object: Doc<'objects'>, row: Doc<'contributions'>, deviceId?: Id<'devices'>,
): Promise<Doc<'contributions'> | null> {
  const backers = ctx.db.query('contributions').withIndex('by_promotedObject_device', (q) => {
    const ofObject = q.eq('promotedObjectId', object._id);
    return deviceId ? ofObject.eq('deviceId', deviceId) : ofObject;
  });
  for await (const backer of backers) {
    if (backer._id !== row._id && backer.status === 'promoted') return backer;
  }
  return null;
}

// A withdrawal removes only what this device shared. An object other devices still back keeps its
// entry; a partner's consented crop and features replace the withdrawn ones (design §4.5).
async function detachContribution(
  ctx: MutationCtx, object: Doc<'objects'>, row: Doc<'contributions'>, partner: Doc<'contributions'>,
): Promise<void> {
  const vectors = ctx.db.query('vectors').withIndex('by_objectId_modelVersion_source', (q) =>
    q.eq('objectId', object._id).eq('modelVersion', row.modelVersion).eq('source', 'user'));
  for await (const vector of vectors) {
    if (cosine(vector.vector, row.vector) < REPLAY_COSINE) continue;
    await ctx.db.delete(vector._id);
    await bumpCounter(ctx, 'vectors', -1);
    break;
  }
  const descriptors = await ctx.db.query('descriptors').withIndex('by_objectId', (q) => q.eq('objectId', object._id)).unique();
  if (descriptors?.extractedFrom === `contribution:${row._id}`) {
    await ctx.db.patch(descriptors._id, {
      descriptors: partner.descriptors, keypoints: partner.keypoints, keypointCount: partner.keypointCount,
      extractedFrom: `contribution:${partner._id}`,
    });
  }
  const provenance = object.provenance ?? { contributionIds: [], deviceIds: [] };
  const sameDevice = await otherBacker(ctx, object, row, row.deviceId);
  const crop = partner.cropStorageId;
  await ctx.db.patch(object._id, {
    ...(row.cropStorageId && object.thumbnailStorageId === row.cropStorageId
      ? { thumbnailStorageId: crop, imageRef: crop ? `storage:${crop}` : undefined }
      : {}),
    provenance: {
      ...provenance,
      contributionIds: provenance.contributionIds.filter((id) => id !== row._id),
      deviceIds: sameDevice ? provenance.deviceIds : provenance.deviceIds.filter((id) => id !== row.deviceId),
    },
  });
}

export const withdraw = mutation({
  args: { contributionId: v.id('contributions') },
  returns: v.null(),
  handler: async (ctx, { contributionId }) => {
    const device = await requireDevice(ctx);
    const row = await ctx.db.get(contributionId);
    if (!row || row.deviceId !== device._id) throw new ConvexError({ code: 'contribution_not_found' });
    if (row.rejectedReason === 'withdrawn') return null;
    const object = row.promotedObjectId ? await ctx.db.get(row.promotedObjectId) : null;
    if (object && !object.reverted) {
      const partner = await otherBacker(ctx, object, row);
      if (partner) {
        await detachContribution(ctx, object, row, partner);
      } else {
        // Hide it in this transaction; the existing paged cascade removes index entries afterwards.
        await beginRevert(ctx, object, 'withdrawn');
        await ctx.scheduler.runAfter(0, internal.revert.revertObjectById, { objectId: object._id, reason: 'withdrawn' });
      }
    }
    if (row.cropStorageId && await ctx.db.system.get('_storage', row.cropStorageId)) await ctx.storage.delete(row.cropStorageId);
    await ctx.db.patch(row._id, { status: 'rejected', rejectedReason: 'withdrawn', cropStorageId: undefined });
    return null;
  },
});

export const mine = query({
  args: {},
  returns: v.array(contributionSummary),
  handler: async (ctx) => {
    const device = await requireDevice(ctx);
    const rows = await ctx.db.query('contributions')
      .withIndex('by_deviceId', (q) => q.eq('deviceId', device._id)).order('desc').take(MAX_LISTED);
    return rows.map((row) => ({
      contributionId: row._id, status: row.status, rejectedReason: row.rejectedReason, venueId: row.venueId,
      scanId: row.scanId, fields: row.fields, evidence: row.evidence, wikidataId: row.wikidataId,
      promotedObjectId: row.promotedObjectId, createdAt: row.createdAt,
    }));
  },
});
