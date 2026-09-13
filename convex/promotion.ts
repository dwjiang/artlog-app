import { ConvexError, type Infer, v } from 'convex/values';

import model from '../shared/model-version.json';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { internalAction, internalMutation, internalQuery, type ActionCtx, type MutationCtx } from './_generated/server';
import { bumpCounter } from './ingest';
import { evaluate, hasStrongEvidence, REPLAY_COSINE, verifiedAccession, workKey, type AgreementDevice } from './lib/agreement';
import { cosine } from './lib/cosine';
import { findOrCreateArtwork } from './lib/promotionArtwork';
import { contributionField, contributionStatus, embedding, evidenceKind } from './lib/validators';
import { isVenueOptedOut } from './lib/venueOptOut';

// Design §4.7 / §8. A `private` contribution has not been evaluated; `pending` has, and waits for an
// independent partner. Both strong and weak candidates include eligible pending partners.
export const RUN_PAGE_SIZE = 200;
export const MULTI_VIEW_PAGE_SIZE = 100;
const PAGE_ITEMS = 64;
const PAGE_BYTES = 4 * 1024 * 1024;
// Each backer carries a full embedding and is re-indexed as a vector row; small batches keep a
// popular work's set within one mutation's read and write budget.
const PARTNER_BATCH_SIZE = 8;
const PENDING_BATCH_SIZE = 8;
export const CONTRIBUTION_PLACEMENT_CONFIDENCE = 0.7;
export const CONFIRMED_TRUST_WEIGHT = 1.0;
// Design §4.6: a second vector for a work needs the same agreement as a contribution — two devices
// resolving to it at one venue — and near-identical views add nothing to the index.
export const MULTI_VIEW_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
export const MULTI_VIEW_DUPLICATE_COSINE = 0.995;

// The docent reads `pageUrl` as the work's own page. An exhibition page names a work only through
// its matched image, so it identifies the artwork (`identityImageUrl`) without becoming its page.
function objectPageUrl(rows: Doc<'contributions'>[]): string | undefined {
  return rows.find((row) => row.sourceUrl && !row.identityImageUrl && hasStrongEvidence(row))?.sourceUrl;
}

const compactContribution = v.object({
  _id: v.id('contributions'), deviceId: v.id('devices'), venueId: v.id('museums'), modelVersion: v.string(),
  vector: embedding, fields: v.object({ title: contributionField, artist: contributionField, accession: v.optional(contributionField) }),
  evidence: v.array(evidenceKind), createdAt: v.number(), status: contributionStatus,
});
type CompactContribution = Infer<typeof compactContribution>;
const cursorArg = v.union(v.string(), v.null());
const contributionPage = v.object({ rows: v.array(compactContribution), cursor: cursorArg });

function compact(row: Doc<'contributions'>): CompactContribution {
  return {
    _id: row._id, deviceId: row.deviceId, venueId: row.venueId, modelVersion: row.modelVersion, vector: row.vector,
    fields: { title: row.fields.title, artist: row.fields.artist, accession: row.fields.accession }, evidence: row.evidence,
    createdAt: row.createdAt, status: row.status,
  };
}

const awaiting = (row: Doc<'contributions'>) => row.status === 'private' || row.status === 'pending';

export const listUnevaluated = internalQuery({
  args: { cursor: cursorArg },
  returns: contributionPage,
  handler: async (ctx, { cursor }) => {
    const result = await ctx.db.query('contributions').withIndex('by_status', (q) => q.eq('status', 'private'))
      .paginate({ cursor, numItems: PAGE_ITEMS, maximumBytesRead: PAGE_BYTES });
    return { rows: result.page.map(compact), cursor: result.isDone ? null : result.continueCursor };
  },
});

export const listVenuePool = internalQuery({
  args: { venueId: v.id('museums'), status: v.union(v.literal('private'), v.literal('pending')), cursor: cursorArg },
  returns: contributionPage,
  handler: async (ctx, { venueId, status, cursor }) => {
    const result = await ctx.db.query('contributions')
      .withIndex('by_venue_status', (q) => q.eq('venueId', venueId).eq('status', status))
      .paginate({ cursor, numItems: PAGE_ITEMS, maximumBytesRead: PAGE_BYTES });
    return { rows: result.page.map(compact), cursor: result.isDone ? null : result.continueCursor };
  },
});

const deviceTrust = v.object({ _id: v.id('devices'), trustWeight: v.number(), banned: v.boolean() });

export const loadDevices = internalQuery({
  args: { deviceIds: v.array(v.id('devices')) },
  returns: v.array(deviceTrust),
  handler: async (ctx, { deviceIds }) => {
    if (deviceIds.length > PAGE_ITEMS) throw new ConvexError({ code: 'device_batch_too_large' });
    const rows = await Promise.all(deviceIds.map((deviceId) => ctx.db.get(deviceId)));
    return rows.flatMap((row) => row ? [{ _id: row._id, trustWeight: row.trustWeight, banned: row.banned }] : []);
  },
});

async function loadDeviceMap(ctx: MutationCtx, deviceIds: Iterable<Id<'devices'>>): Promise<Map<Id<'devices'>, AgreementDevice>> {
  const devices = new Map<Id<'devices'>, AgreementDevice>();
  for (const deviceId of new Set(deviceIds)) {
    const device = await ctx.db.get(deviceId);
    if (device) devices.set(deviceId, { trustWeight: device.trustWeight, banned: device.banned });
  }
  return devices;
}

// The mutation is the gate: it re-runs the rule on the rows as they are now, so a partner that was
// rejected or promoted since the action looked cannot lend agreement.
export const apply = internalMutation({
  args: { contributionId: v.id('contributions'), partners: v.array(v.id('contributions')) },
  returns: v.union(v.id('objects'), v.null()),
  handler: async (ctx, { contributionId, partners }) => {
    const candidate = await ctx.db.get(contributionId);
    if (!candidate || !awaiting(candidate)) return null;
    const venue = await ctx.db.get(candidate.venueId);
    if (!venue || await isVenueOptedOut(ctx, venue)) return null;
    const partnerDocs = (await Promise.all(partners.slice(0, PARTNER_BATCH_SIZE).map((id) => ctx.db.get(id))))
      .filter((doc): doc is Doc<'contributions'> => doc !== null && awaiting(doc));
    const devices = await loadDeviceMap(ctx, [candidate, ...partnerDocs].map((row) => row.deviceId));
    const result = evaluate(candidate, partnerDocs, devices);
    if (!result.promote) return null;
    const accepted = partnerDocs.filter((row) => result.partners.includes(row._id));
    const set = [candidate, ...accepted];
    const artworkId = await findOrCreateArtwork(ctx, candidate, accepted);
    if (artworkId === null) return null;
    const deviceIds = [...new Set(set.map((row) => row.deviceId))];
    const crop = candidate.cropStorageId;
    const objectId = await ctx.db.insert('objects', {
      key: `user:${candidate._id}`, artworkId, ownerId: candidate.venueId,
      accession: candidate.fields.accession?.value, medium: candidate.fields.medium?.value,
      source: 'user', sourceId: candidate._id,
      pageUrl: objectPageUrl(set),
      imageRef: crop ? `storage:${crop}` : undefined, thumbnailStorageId: crop,
      provenance: { contributionIds: set.map((row) => row._id), deviceIds, verifiedAccession: set.map(verifiedAccession).find(Boolean) },
      confirmCount: 0, rejectCount: 0, calibratorPenalty: 0, reverted: false,
    });
    const scan = candidate.scanId ? await ctx.db.get(candidate.scanId) : null;
    await ctx.db.insert('placements', {
      objectId, venueId: candidate.venueId, gallery: scan?.gallery ?? undefined, onView: true,
      source: 'contribution', confidence: CONTRIBUTION_PLACEMENT_CONFIDENCE,
    });
    for (const row of set) {
      await ctx.db.insert('vectors', { objectId, modelVersion: row.modelVersion, source: 'user', vector: row.vector });
    }
    if (!candidate.orbStorageId || !candidate.orbSha256 || !await ctx.db.system.get('_storage', candidate.orbStorageId)) {
      throw new ConvexError({ code: 'reference_descriptors_required' });
    }
    await ctx.db.insert('descriptors', {
      objectId, storageId: candidate.orbStorageId, sha256: candidate.orbSha256, keypointCount: candidate.keypointCount,
      inputSize: model.inputSize, extractedFrom: `contribution:${candidate._id}`,
    });
    for (const row of set) {
      const others = set.filter((other) => other._id !== row._id).map((other) => other._id);
      const promotionNote = hasStrongEvidence(row)
        ? 'strong'
        : `agreement with ${others.join(', ')}${result.differentDays ? ' on different days' : ''}`;
      await ctx.db.patch(row._id, { status: 'promoted', promotedObjectId: objectId, promotionNote });
    }
    for (const deviceId of deviceIds) await ctx.db.patch(deviceId, { trustWeight: CONFIRMED_TRUST_WEIGHT });
    await bumpCounter(ctx, 'objects', 1);
    await bumpCounter(ctx, 'placements', 1);
    await bumpCounter(ctx, 'vectors', set.length);
    await bumpCounter(ctx, 'descriptors', 1);
    if (partners.length > PARTNER_BATCH_SIZE) await ctx.scheduler.runAfter(0, internal.promotion.appendPartners, {
      contributionId, partners: partners.slice(PARTNER_BATCH_SIZE),
    });
    return objectId;
  },
});

export const appendPartners = internalMutation({
  args: {
    contributionId: v.id('contributions'), partners: v.array(v.id('contributions')),
    batch: v.optional(v.object({ ids: v.array(v.id('contributions')), cursor: v.string() })),
  },
  returns: v.null(),
  handler: async (ctx, { contributionId, partners, batch }) => {
    const anchor = await ctx.db.get(contributionId);
    if (anchor?.status !== 'promoted' || !anchor.promotedObjectId) return null;
    const object = await ctx.db.get(anchor.promotedObjectId);
    const venue = await ctx.db.get(anchor.venueId);
    if (!object || object.reverted || object.mergedInto || !venue || await isVenueOptedOut(ctx, venue)) return null;
    const takedown = await ctx.db.query('takedowns').withIndex('by_artworkId', (q) => q.eq('artworkId', object.artworkId)).first();
    if (takedown) return null;
    const batchIds = batch?.ids ?? partners.slice(0, PARTNER_BATCH_SIZE);
    const remaining = batch ? partners : partners.slice(PARTNER_BATCH_SIZE);
    if (batchIds.length > PARTNER_BATCH_SIZE) throw new ConvexError({ code: 'contribution_batch_too_large' });
    const rows = (await Promise.all(batchIds.map((id) => ctx.db.get(id))))
      .filter((row): row is Doc<'contributions'> => row !== null && awaiting(row));
    const devices = await loadDeviceMap(ctx, [anchor, ...rows].map((row) => row.deviceId));
    const result = evaluate(anchor, rows, devices, object.provenance?.verifiedAccession);
    let accepted = rows.filter((row) => result.partners.includes(row._id));
    if (accepted.length) {
      const page = await ctx.db.query('vectors').withIndex('by_objectId_modelVersion_source', (q) =>
        q.eq('objectId', object._id).eq('modelVersion', anchor.modelVersion).eq('source', 'user'))
        .paginate({ cursor: batch?.cursor ?? null, numItems: PAGE_ITEMS, maximumBytesRead: PAGE_BYTES });
      accepted = accepted.filter((row) => !page.page.some((vector) => cosine(vector.vector, row.vector) >= REPLAY_COSINE));
      if (accepted.length && !page.isDone) {
        await ctx.scheduler.runAfter(0, internal.promotion.appendPartners, {
          contributionId, partners: remaining, batch: { ids: accepted.map((row) => row._id), cursor: page.continueCursor },
        });
        return null;
      }
    }
    if (accepted.length && await findOrCreateArtwork(ctx, anchor, accepted, object.artworkId) === null) accepted = [];
    for (const row of accepted) {
      await ctx.db.insert('vectors', { objectId: object._id, modelVersion: row.modelVersion, source: 'user', vector: row.vector });
      await ctx.db.patch(row._id, {
        status: 'promoted', promotedObjectId: object._id,
        promotionNote: hasStrongEvidence(row) ? 'strong' : `agreement with ${anchor._id}`,
      });
      await ctx.db.patch(row.deviceId, { trustWeight: CONFIRMED_TRUST_WEIGHT });
    }
    if (accepted.length) {
      await ctx.db.patch(object._id, {
        pageUrl: object.pageUrl ?? objectPageUrl(accepted),
        provenance: {
          contributionIds: [...new Set([...(object.provenance?.contributionIds ?? []), ...accepted.map((row) => row._id)])],
          deviceIds: [...new Set([...(object.provenance?.deviceIds ?? []), ...accepted.map((row) => row.deviceId)])],
          verifiedAccession: object.provenance?.verifiedAccession ?? accepted.map(verifiedAccession).find(Boolean),
        },
      });
      await bumpCounter(ctx, 'vectors', accepted.length);
    }
    if (remaining.length) await ctx.scheduler.runAfter(0, internal.promotion.appendPartners, {
      contributionId, partners: remaining,
    });
    return null;
  },
});

export const markPending = internalMutation({
  args: { contributionIds: v.array(v.id('contributions')) },
  returns: v.null(),
  handler: async (ctx, { contributionIds }) => {
    if (contributionIds.length > PENDING_BATCH_SIZE) throw new ConvexError({ code: 'contribution_batch_too_large' });
    for (const contributionId of contributionIds) {
      const row = await ctx.db.get(contributionId);
      if (row?.status === 'private') await ctx.db.patch(contributionId, { status: 'pending' });
    }
    return null;
  },
});

const multiViewCandidate = v.object({
  _id: v.id('feedback'), objectId: v.id('objects'), venueId: v.optional(v.id('museums')),
});
type MultiViewCandidate = Infer<typeof multiViewCandidate>;
const multiViewPage = v.object({ rows: v.array(multiViewCandidate), cursor: cursorArg });

export const readMultiViewCursor = internalQuery({
  args: {},
  returns: cursorArg,
  handler: async (ctx) => (await ctx.db.query('promotionState').first())?.multiViewCursor ?? null,
});

export const advanceMultiViewCursor = internalMutation({
  args: { from: cursorArg, to: cursorArg },
  returns: v.null(),
  handler: async (ctx, { from, to }) => {
    const state = await ctx.db.query('promotionState').first();
    // A manually invoked run may overlap the cron; an older run must not rewind its cursor.
    if ((state?.multiViewCursor ?? null) !== from) return null;
    if (state) await ctx.db.patch(state._id, { multiViewCursor: to });
    else await ctx.db.insert('promotionState', { multiViewCursor: to });
    return null;
  },
});

export const listMultiViewCandidates = internalQuery({
  args: { cursor: cursorArg, limit: v.number() },
  returns: multiViewPage,
  handler: async (ctx, { cursor, limit }) => {
    const result = await ctx.db.query('feedback')
      .withIndex('by_resolution_multiView', (q) => q.eq('resolution.kind', 'runner_up').eq('multiViewAt', undefined))
      .paginate({ cursor, numItems: Math.max(1, Math.min(PAGE_ITEMS, limit)), maximumBytesRead: PAGE_BYTES });
    return {
      rows: result.page.map((row) => ({ _id: row._id, objectId: row.resolution.objectId!, venueId: row.venueId })),
      cursor: result.isDone ? null : result.continueCursor,
    };
  },
});

const agreementPage = v.object({ rows: v.array(v.object({ _id: v.id('feedback'), deviceId: v.id('devices') })), cursor: cursorArg });

export const listMultiViewAgreement = internalQuery({
  args: { objectId: v.id('objects'), venueId: v.id('museums'), since: v.number(), cursor: cursorArg },
  returns: agreementPage,
  handler: async (ctx, { objectId, venueId, since, cursor }) => {
    const page = await ctx.db.query('feedback').withIndex('by_resolution_object_venue', (q) =>
      q.eq('resolution.kind', 'runner_up').eq('resolution.objectId', objectId).eq('venueId', venueId).gte('createdAt', since))
      .paginate({ cursor, numItems: PAGE_ITEMS, maximumBytesRead: PAGE_BYTES });
    const rows = [];
    for (const row of page.page) {
      const device = await ctx.db.get(row.deviceId);
      if (device && !device.banned) rows.push({ _id: row._id, deviceId: row.deviceId });
    }
    return { rows, cursor: page.isDone ? null : page.continueCursor };
  },
});

const multiViewResult = v.object({ inserted: v.boolean(), cursor: cursorArg });

// Each transaction checks one feedback row against one page of existing views. New views append
// to this index, so the final page's range read also serializes concurrent duplicate insertions.
export const applyMultiView = internalMutation({
  args: { feedbackId: v.id('feedback'), agreementIds: v.array(v.id('feedback')), cursor: cursorArg },
  returns: multiViewResult,
  handler: async (ctx, { feedbackId, agreementIds, cursor }) => {
    const done = { inserted: false, cursor: null };
    const now = Date.now();
    const since = now - MULTI_VIEW_WINDOW_MS;
    const row = await ctx.db.get(feedbackId);
    if (!row || row.resolution.kind !== 'runner_up' || row.multiViewAt !== undefined) return done;
    const object = row.resolution.objectId ? await ctx.db.get(row.resolution.objectId) : null;
    const venue = row.venueId ? await ctx.db.get(row.venueId) : null;
    const device = await ctx.db.get(row.deviceId);
    const takedown = object && await ctx.db.query('takedowns').withIndex('by_artworkId', (q) => q.eq('artworkId', object.artworkId)).first();
    if (!object || object.reverted || object.mergedInto || !venue || await isVenueOptedOut(ctx, venue) ||
      takedown || !device || device.banned || row.createdAt < since) {
      await ctx.db.patch(row._id, { multiViewAt: now });
      return done;
    }
    if (agreementIds.length !== 2) return done;
    const devices = new Set<Id<'devices'>>();
    for (const id of agreementIds) {
      const partner = await ctx.db.get(id);
      if (!partner || partner.resolution.kind !== 'runner_up' || partner.resolution.objectId !== object._id ||
        partner.venueId !== row.venueId || partner.createdAt < since) return done;
      const partnerDevice = await ctx.db.get(partner.deviceId);
      if (!partnerDevice || partnerDevice.banned) return done;
      devices.add(partner.deviceId);
    }
    if (devices.size !== 2) return done;
    const page = await ctx.db.query('vectors').withIndex('by_objectId_modelVersion_source', (q) =>
      q.eq('objectId', object._id).eq('modelVersion', row.modelVersion).eq('source', 'user_scan'))
      .paginate({ cursor, numItems: PAGE_ITEMS, maximumBytesRead: PAGE_BYTES });
    const duplicate = page.page.find((vector) => cosine(vector.vector, row.vector) >= MULTI_VIEW_DUPLICATE_COSINE);
    if (!duplicate && !page.isDone) return { inserted: false, cursor: page.continueCursor };
    const multiViewVectorId = duplicate ? undefined : await ctx.db.insert('vectors', {
      objectId: object._id, modelVersion: row.modelVersion, source: 'user_scan', vector: row.vector,
    });
    const [firstDeviceId, secondDeviceId] = [...devices];
    await ctx.db.patch(row._id, {
      multiViewAt: now, multiViewVectorId, multiViewDuplicateVectorId: duplicate?._id,
      multiViewAgreement: { firstDeviceId, secondDeviceId },
    });
    if (multiViewVectorId) await bumpCounter(ctx, 'vectors', 1);
    return { inserted: multiViewVectorId !== undefined, cursor: null };
  },
});

async function collect<T>(fetchPage: (cursor: string | null) => Promise<{ rows: T[]; cursor: string | null }>, limit: number): Promise<T[]> {
  const rows: T[] = [];
  let cursor: string | null = null;
  do {
    const result = await fetchPage(cursor);
    rows.push(...result.rows);
    cursor = result.cursor;
  } while (cursor !== null && rows.length < limit);
  return rows.slice(0, limit);
}

function groupBy<T, K>(rows: T[], key: (row: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const row of rows) {
    const group = groups.get(key(row));
    if (group) group.push(row);
    else groups.set(key(row), [row]);
  }
  return groups;
}

async function promoteContributions(ctx: ActionCtx): Promise<{ evaluated: number; promoted: number; pending: number }> {
  const candidates = await collect((cursor) => ctx.runQuery(internal.promotion.listUnevaluated, { cursor }), RUN_PAGE_SIZE);
  const settled = new Set<Id<'contributions'>>();
  const pending: Id<'contributions'>[] = [];
  let promoted = 0;
  for (const [venueId, venueCandidates] of groupBy(candidates, (row) => row.venueId)) {
    const pool: CompactContribution[] = [];
    const keys = new Set(venueCandidates.map((row) => `${row.modelVersion}:${workKey(row.fields)}`));
    const devices = new Map<Id<'devices'>, AgreementDevice>();
    for (const status of ['private', 'pending'] as const) {
      let cursor: string | null = null;
      do {
        const page: Infer<typeof contributionPage> = await ctx.runQuery(internal.promotion.listVenuePool, { venueId, status, cursor });
        const matching = page.rows.filter((row) => keys.has(`${row.modelVersion}:${workKey(row.fields)}`));
        const deviceIds = [...new Set(matching.map((row) => row.deviceId))].filter((id) => !devices.has(id));
        if (deviceIds.length) {
          const trust = await ctx.runQuery(internal.promotion.loadDevices, { deviceIds });
          for (const device of trust) devices.set(device._id, device);
        }
        pool.push(...matching);
        cursor = page.cursor;
      } while (cursor !== null);
    }
    for (const candidate of venueCandidates) {
      if (settled.has(candidate._id)) continue;
      const result = evaluate(candidate, pool.filter((row) => !settled.has(row._id)), devices);
      const objectId = result.promote
        ? await ctx.runMutation(internal.promotion.apply, { contributionId: candidate._id, partners: result.partners })
        : null;
      if (objectId === null) {
        pending.push(candidate._id);
        continue;
      }
      promoted++;
      settled.add(candidate._id);
      for (const partner of result.partners) settled.add(partner);
    }
  }
  for (let i = 0; i < pending.length; i += PENDING_BATCH_SIZE) {
    await ctx.runMutation(internal.promotion.markPending, { contributionIds: pending.slice(i, i + PENDING_BATCH_SIZE) });
  }
  return { evaluated: candidates.length, promoted, pending: pending.length };
}

async function findMultiViewAgreement(ctx: ActionCtx, objectId: Id<'objects'>, venueId: Id<'museums'>): Promise<Id<'feedback'>[]> {
  const devices = new Map<Id<'devices'>, Id<'feedback'>>();
  const since = Date.now() - MULTI_VIEW_WINDOW_MS;
  let cursor: string | null = null;
  do {
    const page: Infer<typeof agreementPage> = await ctx.runQuery(internal.promotion.listMultiViewAgreement, { objectId, venueId, since, cursor });
    for (const row of page.rows) {
      devices.set(row.deviceId, row._id);
      if (devices.size === 2) return [...devices.values()];
    }
    cursor = page.cursor;
  } while (cursor !== null);
  return [];
}

async function promoteMultiView(ctx: ActionCtx): Promise<number> {
  const from = await ctx.runQuery(internal.promotion.readMultiViewCursor, {});
  let cursor = from;
  const rows: MultiViewCandidate[] = [];
  do {
    const page: Infer<typeof multiViewPage> = await ctx.runQuery(internal.promotion.listMultiViewCandidates, { cursor, limit: MULTI_VIEW_PAGE_SIZE - rows.length });
    rows.push(...page.rows);
    cursor = page.cursor;
  } while (cursor !== null && rows.length < MULTI_VIEW_PAGE_SIZE);
  let inserted = 0;
  const groups = groupBy(rows, (row) => `${row.objectId}:${row.venueId ?? ''}`);
  for (const group of groups.values()) {
    const { objectId, venueId } = group[0];
    const agreementIds = venueId ? await findMultiViewAgreement(ctx, objectId, venueId) : [];
    for (const row of group) {
      let vectorCursor: string | null = null;
      do {
        const result: Infer<typeof multiViewResult> = await ctx.runMutation(internal.promotion.applyMultiView, { feedbackId: row._id, agreementIds, cursor: vectorCursor });
        inserted += Number(result.inserted);
        vectorCursor = result.cursor;
      } while (vectorCursor !== null);
    }
  }
  await ctx.runMutation(internal.promotion.advanceMultiViewCursor, { from, to: cursor });
  return inserted;
}

export const runSummary = v.object({
  evaluated: v.number(), promoted: v.number(), pending: v.number(), multiViewVectors: v.number(),
});

// Cron every ten minutes (convex/crons.ts); also `npx convex run promotion:run`.
export const run = internalAction({
  args: {},
  returns: runSummary,
  handler: async (ctx) => {
    const contributions = await promoteContributions(ctx);
    const multiViewVectors = await promoteMultiView(ctx);
    return { ...contributions, multiViewVectors };
  },
});
