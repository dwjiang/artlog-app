import { ConvexError, type Infer, v } from 'convex/values';

import { internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import { action, internalMutation, internalQuery } from './_generated/server';
import { resolveFalseRejections } from './feedback';
import { READ_TIMEOUT_MS, assertImageBase64, moderateVerifiedFields } from './label';
import { requireDeviceFromAction } from './lib/auth';
import {
  DESCRIBE_MAX_TOKENS,
  DESCRIBE_PROMPT_VERSION,
  DESCRIBE_SCHEMA,
  DESCRIBE_SYSTEM_PROMPT,
  DESCRIBE_USER_PROMPT,
  parseDescription,
  searchQuery,
} from './lib/describePrompt';
import { isEnabled } from './lib/flags';
import {
  FIELD_NAMES,
  displayLabelFlow,
  evidenceSummary,
  imageCheckPasses,
  labelField,
  selectSearchCandidates,
} from './lib/labelVerify';
import { limitDevice } from './lib/rateLimits';
import { reconcileSpend, reserveSpend } from './lib/spend';
import { search } from './lib/tavily';
import { chatJson } from './lib/tokenFactory';
import {
  imageCheck,
  labelFlow,
  labelFlowDisplay,
  museumSearchDisplay,
  type LabelField,
  type LabelFields,
  type LabelFlow,
  type LabelFlowDisplay,
  type MuseumSearchDisplay,
  type SearchCandidate,
} from './lib/validators';
import { venueHosts } from './lib/venueFetch';
import { isVenueOptedOut } from './lib/venueOptOut';
import schema from './schema';

// One description and its single retry (tokenFactory.chatJson) plus one search credit (decision 007).
const MAX_DESCRIBE_CALLS = 2;
const SEARCH_CREDITS = 1;
const MAX_RESULTS = 5;

type Retained = Extract<MuseumSearchDisplay, { stage: 'candidates' | 'confirmed' }>;

export const load = internalQuery({
  args: { scanId: v.id('scans'), deviceId: v.id('devices') },
  returns: v.object({ scan: schema.doc('scans'), hosts: v.array(v.string()) }),
  handler: async (ctx, { scanId, deviceId }) => {
    const scan = await ctx.db.get(scanId);
    if (!scan || scan.deviceId !== deviceId || !scan.venueId || scan.status !== 'identified' || scan.outcome === 'confident') {
      throw new ConvexError({ code: 'invalid_scan' });
    }
    const venue = await ctx.db.get(scan.venueId);
    const hosts = venue ? venueHosts(venue) : [];
    if (!venue || !hosts.length) throw new ConvexError({ code: 'no_venue_site' });
    if (await isVenueOptedOut(ctx, venue)) throw new ConvexError({ code: 'venue_opted_out' });
    return { scan, hosts };
  },
});

const reservation = v.object({ tokenFactoryDay: v.string(), tavilyDay: v.string() });

// One transaction for both providers: a cap on either leaves both counters unchanged.
export const reserveSearchSpend = internalMutation({
  args: {},
  returns: reservation,
  handler: async (ctx) => ({
    tokenFactoryDay: await reserveSpend(ctx, 'tokenFactory', MAX_DESCRIBE_CALLS),
    tavilyDay: await reserveSpend(ctx, 'tavily', SEARCH_CREDITS),
  }),
});

export const settleSearchSpend = internalMutation({
  args: { reservation, modelCalls: v.number(), searchCredits: v.number() },
  returns: v.null(),
  handler: async (ctx, { reservation: days, modelCalls, searchCredits }) => {
    await reconcileSpend(ctx, 'tokenFactory', { day: days.tokenFactoryDay, reserved: MAX_DESCRIBE_CALLS, actual: modelCalls });
    await reconcileSpend(ctx, 'tavily', { day: days.tavilyDay, reserved: SEARCH_CREDITS, actual: searchCredits });
    return null;
  },
});

function ownedCurrentScan(scan: Doc<'scans'> | null, args: { deviceId: Doc<'devices'>['_id']; generation: number }): Doc<'scans'> {
  if (!scan || scan.deviceId !== args.deviceId) throw new ConvexError({ code: 'invalid_scan' });
  if (scan.generation !== args.generation) throw new ConvexError({ code: 'scan_restarted' });
  return scan;
}

export const beginSearch = internalMutation({
  args: { scanId: v.id('scans'), deviceId: v.id('devices'), generation: v.number() },
  returns: v.number(),
  handler: async (ctx, args) => {
    const scan = ownedCurrentScan(await ctx.db.get(args.scanId), args);
    const revision = (scan.museumSearchRevision ?? 0) + 1;
    await ctx.db.patch(scan._id, { museumSearchRevision: revision });
    return revision;
  },
});

export const write = internalMutation({
  args: {
    scanId: v.id('scans'), deviceId: v.id('devices'), generation: v.number(), revision: v.number(),
    museumSearch: museumSearchDisplay,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const scan = ownedCurrentScan(await ctx.db.get(args.scanId), args);
    if (scan.museumSearchRevision !== args.revision) throw new ConvexError({ code: 'search_superseded' });
    await ctx.db.patch(scan._id, { museumSearch: args.museumSearch, updatedAt: Date.now() });
    return null;
  },
});

export const searchMuseumSite = action({
  args: { scanId: v.id('scans'), imageBase64: v.string() },
  returns: museumSearchDisplay,
  handler: async (ctx, { scanId, imageBase64 }): Promise<MuseumSearchDisplay> => {
    const device = await requireDeviceFromAction(ctx);
    if (!isEnabled('museumSearch')) throw new ConvexError({ code: 'feature_off' });
    const { scan, hosts } = await ctx.runQuery(internal.museumSearch.load, { scanId, deviceId: device._id });
    assertImageBase64(imageBase64);
    await limitDevice(ctx, 'museumSearch', device._id);
    const model = process.env.LABEL_VL_MODEL;
    if (!model) throw new ConvexError({ code: 'model_unconfigured' });
    const revision = await ctx.runMutation(internal.museumSearch.beginSearch, {
      scanId, deviceId: device._id, generation: scan.generation,
    });
    const write = (museumSearch: MuseumSearchDisplay) => ctx.runMutation(internal.museumSearch.write, {
      scanId, deviceId: device._id, generation: scan.generation, revision, museumSearch,
    });
    let days: Infer<typeof reservation>;
    try {
      days = await ctx.runMutation(internal.museumSearch.reserveSearchSpend, {});
    } catch (error) {
      if (!(error instanceof ConvexError) || error.data.code !== 'spend_cap') throw error;
      const capped: MuseumSearchDisplay = { stage: 'none', reason: 'cap', updatedAt: Date.now() };
      await write(capped);
      return capped;
    }
    // Usage is undefined while a request is in flight, so an ambiguous timeout keeps its reservation.
    let modelCalls: number | undefined;
    let searchCredits: number | undefined = 0;
    try {
      let described;
      try {
        // The photo goes to the model and nowhere else: never stored, never logged. The description
        // and artist guess only form the query; neither is written to the scan or the logs.
        described = await chatJson({
          model, system: DESCRIBE_SYSTEM_PROMPT, user: DESCRIBE_USER_PROMPT, imageBase64, schemaName: 'describe',
          schema: DESCRIBE_SCHEMA, maxTokens: DESCRIBE_MAX_TOKENS, parse: parseDescription, timeoutMs: READ_TIMEOUT_MS,
        });
      } catch (error) {
        if (error instanceof ConvexError && typeof error.data.calls === 'number') modelCalls = error.data.calls;
        throw error;
      }
      modelCalls = described.calls;
      searchCredits = undefined;
      let response;
      try {
        response = await search({
          query: searchQuery(described.value), includeDomains: hosts, includeImages: false, maxResults: MAX_RESULTS,
        });
      } catch (error) {
        if (error instanceof ConvexError && error.data.code === 'search_unconfigured') searchCredits = 0;
        throw error;
      }
      searchCredits = response.credits;
      const candidates = await selectSearchCandidates(response, hosts);
      const updatedAt = Date.now();
      const state: MuseumSearchDisplay = candidates.length
        ? { stage: 'candidates', candidates, promptVersion: DESCRIBE_PROMPT_VERSION, updatedAt }
        : { stage: 'none', reason: 'no_candidates', promptVersion: DESCRIBE_PROMPT_VERSION, updatedAt };
      await write(state);
      return state;
    } finally {
      await ctx.runMutation(internal.museumSearch.settleSearchSpend, {
        reservation: days, modelCalls: modelCalls ?? MAX_DESCRIBE_CALLS, searchCredits: searchCredits ?? SEARCH_CREDITS,
      });
    }
  },
});

function retainedCandidate(
  state: MuseumSearchDisplay | undefined, sourceUrl: string, imageUrl: string,
): { state: Retained; candidate: SearchCandidate } | null {
  if (!state || state.stage === 'none') return null;
  const candidate = state.candidates.find((entry) => entry.sourceUrl === sourceUrl && entry.imageUrls.includes(imageUrl));
  return candidate ? { state, candidate } : null;
}

// The museum's page names the work and the phone confirmed its image, so title and artist carry
// `tavily+image`; the page's other fields carry `tavily`. All are locked.
function candidateFields(candidate: SearchCandidate): LabelFields {
  const fields: LabelFields = {};
  for (const name of FIELD_NAMES) {
    const value = candidate.fields[name];
    if (value) fields[name] = labelField(value, name === 'title' || name === 'artist' ? 'tavily+image' : 'tavily');
  }
  return fields;
}

function confirmedFlow(candidate: SearchCandidate, imageUrl: string, fields: LabelFields, moderation: 'clear' | 'flagged'): LabelFlow {
  return {
    stage: 'verified', fields, evidence: evidenceSummary(fields), warnings: [], moderation,
    sourceUrl: candidate.sourceUrl, imageUrls: [imageUrl], updatedAt: Date.now(),
  };
}

function sameList(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  return (a ?? []).length === (b ?? []).length && (a ?? []).every((value, index) => value === b?.[index]);
}

function sameField(a: LabelField | undefined, b: LabelField | undefined): boolean {
  if (!a || !b) return a === b;
  return a.value === b.value && a.evidence === b.evidence && a.locked === b.locked && a.confidence === b.confidence;
}

// A retried confirmation of the same page and image (lost response, reopened card) returns the
// stored result untouched; a flagged result with empty fields for that selection counts as stored too.
function storedConfirmation(scan: Doc<'scans'>, flow: LabelFlow): LabelFlow | null {
  const search = scan.museumSearch;
  const stored = scan.labelFlow;
  if (search?.stage !== 'confirmed' || !stored || stored.stage !== 'verified') return null;
  if (search.selected.sourceUrl !== flow.sourceUrl || search.selected.imageUrl !== flow.imageUrls?.[0]) return null;
  if (stored.sourceUrl !== flow.sourceUrl || !sameList(stored.imageUrls, flow.imageUrls)) return null;
  const flaggedEmpty = stored.moderation === 'flagged' && FIELD_NAMES.every((name) => !stored.fields[name]) && !stored.evidence.length;
  const sameResult = FIELD_NAMES.every((name) => sameField(stored.fields[name], flow.fields[name])) &&
    sameList(stored.evidence, flow.evidence);
  return flaggedEmpty || sameResult ? stored : null;
}

export const confirm = internalMutation({
  args: { scanId: v.id('scans'), deviceId: v.id('devices'), generation: v.number(), labelFlow },
  returns: labelFlowDisplay,
  handler: async (ctx, args): Promise<LabelFlowDisplay> => {
    const scan = ownedCurrentScan(await ctx.db.get(args.scanId), args);
    const flow = args.labelFlow;
    const imageUrl = flow.imageUrls?.[0];
    const selected = flow.sourceUrl !== undefined && imageUrl !== undefined ? { sourceUrl: flow.sourceUrl, imageUrl } : null;
    const retained = selected && retainedCandidate(scan.museumSearch, selected.sourceUrl, selected.imageUrl);
    if (!selected || !retained) throw new ConvexError({ code: 'unknown_candidate' });
    const stored = storedConfirmation(scan, flow);
    if (stored) return displayLabelFlow(stored);
    await ctx.db.patch(scan._id, {
      labelFlow: flow,
      // Confirming a retained candidate supersedes any search still in flight.
      museumSearchRevision: (scan.museumSearchRevision ?? 0) + 1,
      museumSearch: {
        stage: 'confirmed', candidates: retained.state.candidates, promptVersion: retained.state.promptVersion,
        selected, updatedAt: flow.updatedAt,
      },
      updatedAt: Date.now(),
    });
    await resolveFalseRejections(ctx, scan, flow);
    return displayLabelFlow(flow);
  },
});

export const confirmSearchCandidate = action({
  args: { scanId: v.id('scans'), sourceUrl: v.string(), imageCheck },
  returns: labelFlowDisplay,
  handler: async (ctx, { scanId, sourceUrl, imageCheck: check }): Promise<LabelFlowDisplay> => {
    const device = await requireDeviceFromAction(ctx);
    if (!isEnabled('museumSearch')) throw new ConvexError({ code: 'feature_off' });
    const { scan } = await ctx.runQuery(internal.museumSearch.load, { scanId, deviceId: device._id });
    const retained = retainedCandidate(scan.museumSearch, sourceUrl, check.url);
    if (!retained) throw new ConvexError({ code: 'unknown_candidate' });
    if (!imageCheckPasses(check)) throw new ConvexError({ code: 'image_mismatch' });
    const fields = candidateFields(retained.candidate);
    const clear = confirmedFlow(retained.candidate, check.url, fields, 'clear');
    const stored = storedConfirmation(scan, clear);
    if (stored) return displayLabelFlow(stored);
    await limitDevice(ctx, 'labelVerify', device._id);
    const moderation = await moderateVerifiedFields(ctx, fields, scan.labelFlow);
    return ctx.runMutation(internal.museumSearch.confirm, {
      scanId, deviceId: device._id, generation: scan.generation,
      labelFlow: moderation === 'flagged' ? confirmedFlow(retained.candidate, check.url, {}, 'flagged') : clear,
    });
  },
});
