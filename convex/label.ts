import { reportBackendError, withErrorReporting } from './lib/observability';
import { ConvexError, v } from 'convex/values';

import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { action, internalMutation, internalQuery, type ActionCtx } from './_generated/server';
import { resolveFalseRejections } from './feedback';
import { requireDeviceFromAction } from './lib/auth';
import { isEnabled } from './lib/flags';
import {
  LABEL_MAX_TOKENS,
  LABEL_SCHEMA,
  LABEL_SYSTEM_PROMPT,
  PROMPT_VERSION,
  labelUser,
  parseLabelReading,
  titleWithoutDate,
  type LabelReading,
} from './lib/labelPrompt';
import {
  FIELD_NAMES,
  LOCKING_EVIDENCE,
  MUSEUM_EVIDENCE,
  displayLabelFlow,
  evidenceSummary,
  findArtist,
  findWikidataPainting,
  imageCheckPasses,
  labelField,
  selectTavilyEvidence,
  trimInput,
  venueCountryMatch,
  verifyAccession,
  withEvidence,
  type LabelInput,
  type TavilyEvidence,
  type TavilyPair,
} from './lib/labelVerify';
import { checkText } from './lib/moderation';
import { extractPage, hasArtworkMetadata } from './lib/pageExtract';
import { assessPlausibility } from './lib/plausibility';
import { limitDevice } from './lib/rateLimits';
import { searchWithCredit } from './lib/tavilySpend';
import { personMatches } from './lib/textMatch';
import { chatJson } from './lib/tokenFactory';
import {
  imageCheck,
  labelFlow,
  labelFlowDisplay,
  type ImageCheck,
  type LabelFieldName,
  type LabelFields,
  type LabelFlow,
  type LabelFlowDisplay,
} from './lib/validators';
import { allowedVenueUrl, fetchVenuePage, venueHosts } from './lib/venueFetch';
import { lifespan, type WikidataEntity } from './lib/wikidata';
import schema from './schema';
import { MAX_OCR_LINE_CHARS, MAX_OCR_LINES, type OcrLine } from '../shared/label/ocr-limits';

// The label read and the moderation check are each retried at most once (tokenFactory.chatJson).
const MAX_READ_CALLS = 4;
const MAX_MODERATION_CALLS = 2;
// Super's measured p95 on the 25-label set was 2.6 s; the default 8 s leaves no room for a slow day.
const READ_TIMEOUT_MS = 20_000;

const labelInput = v.object({
  title: v.optional(v.string()), artist: v.optional(v.string()), date: v.optional(v.string()),
  accession: v.optional(v.string()), medium: v.optional(v.string()), creditLine: v.optional(v.string()),
});

export const load = internalQuery({
  args: { scanId: v.id('scans'), deviceId: v.id('devices') },
  returns: v.object({ scan: schema.doc('scans'), venue: v.union(schema.doc('museums'), v.null()) }),
  handler: async (ctx, { scanId, deviceId }) => {
    const scan = await ctx.db.get(scanId);
    if (!scan || scan.deviceId !== deviceId) throw new ConvexError({ code: 'scan_not_found' });
    return { scan, venue: scan.venueId ? await ctx.db.get(scan.venueId) : null };
  },
});

export const write = internalMutation({
  args: { scanId: v.id('scans'), deviceId: v.id('devices'), generation: v.number(), labelFlow },
  returns: v.null(),
  handler: async (ctx, args) => {
    const scan = await ctx.db.get(args.scanId);
    if (!scan || scan.deviceId !== args.deviceId) throw new ConvexError({ code: 'scan_not_found' });
    if (scan.generation !== args.generation) throw new ConvexError({ code: 'scan_restarted' });
    await ctx.db.patch(scan._id, { labelFlow: args.labelFlow, updatedAt: Date.now() });
    await resolveFalseRejections(ctx, scan, args.labelFlow);
    return null;
  },
});

async function start(ctx: ActionCtx, scanId: Id<'scans'>) {
  const device = await requireDeviceFromAction(ctx);
  if (!isEnabled('labelFlow')) throw new ConvexError({ code: 'feature_off' });
  const context = await ctx.runQuery(internal.label.load, { scanId, deviceId: device._id });
  return { device, ...context };
}

// The phone's OCR lines in reading order; the phone trims to the bounds, so more is a bad request.
const ocrLine = v.object({ text: v.string(), confidence: v.number() });

function usableLines(lines: OcrLine[]): OcrLine[] {
  if (lines.length > MAX_OCR_LINES || lines.some((line) => line.text.length > MAX_OCR_LINE_CHARS ||
    !Number.isFinite(line.confidence) || line.confidence < 0 || line.confidence > 1)) throw new ConvexError({ code: 'bad_lines' });
  const usable = lines.map((line) => ({ text: line.text.trim(), confidence: line.confidence })).filter((line) => line.text);
  if (!usable.length) throw new ConvexError({ code: 'nothing_read' });
  return usable;
}

const READING_KEYS: Record<LabelFieldName, keyof LabelReading> = {
  title: 'title', artist: 'artist', date: 'work_date', accession: 'accession', medium: 'medium', creditLine: 'credit_line',
};

function readFields(reading: LabelReading): LabelFields {
  const fields: LabelFields = {};
  for (const name of FIELD_NAMES) {
    const key = READING_KEYS[name];
    const value = key === 'title' && reading.title ? titleWithoutDate(reading.title, reading.work_date) : reading[key];
    if (typeof value !== 'string' || !value.trim()) continue;
    const confidence = key in reading.confidence ? reading.confidence[key as keyof LabelReading['confidence']] : undefined;
    fields[name] = labelField(value.trim(), 'ocr', confidence);
  }
  return fields;
}

export const fetchQr = action({
  args: { scanId: v.id('scans'), url: v.string() },
  returns: labelFlowDisplay,
  handler: async (ctx, { scanId, url }): Promise<LabelFlowDisplay> => withErrorReporting('label.fetchQr', async () => {
    const { device, scan, venue } = await start(ctx, scanId);
    const hosts = venue ? venueHosts(venue) : [];
    if (!allowedVenueUrl(url, hosts)) throw new ConvexError({ code: 'qr_host_not_allowed' });
    await limitDevice(ctx, 'labelVerify', device._id);
    const page = await fetchVenuePage(url, hosts);
    const extracted = extractPage(page.html);
    if (!hasArtworkMetadata(extracted)) throw new ConvexError({ code: 'qr_no_artwork' });
    const fields: LabelFields = {};
    for (const name of FIELD_NAMES) {
      const value = extracted.fields[name];
      if (value) fields[name] = labelField(value, 'qr');
    }
    const flow: LabelFlowDisplay = {
      stage: 'qr', fields, evidence: ['qr'], warnings: [], moderation: 'unchecked', sourceUrl: page.url, updatedAt: Date.now(),
    };
    await ctx.runMutation(internal.label.write, { scanId, deviceId: device._id, generation: scan.generation, labelFlow: flow });
    return flow;
  }),
});

export const readLabel = action({
  args: { scanId: v.id('scans'), lines: v.array(ocrLine) },
  returns: labelFlowDisplay,
  handler: async (ctx, { scanId, lines }): Promise<LabelFlowDisplay> => withErrorReporting('label.readLabel', async () => {
    const { device, scan } = await start(ctx, scanId);
    const usable = usableLines(lines);
    await limitDevice(ctx, 'labelRead', device._id);
    const model = process.env.LABEL_MODEL;
    if (!model) throw new ConvexError({ code: 'model_unconfigured' });
    const day = await ctx.runMutation(internal.spend.reserve, { kind: 'tokenFactory', amount: MAX_READ_CALLS });
    let calls = 0;
    try {
      // The photo stays on the phone; only its OCR lines reach the model, and they are never logged.
      const reading = await chatJson({
        model, system: LABEL_SYSTEM_PROMPT, user: labelUser(usable), schemaName: 'label',
        schema: LABEL_SCHEMA, maxTokens: LABEL_MAX_TOKENS, parse: parseLabelReading, timeoutMs: READ_TIMEOUT_MS,
      });
      calls += reading.calls;
      const text = reading.value;
      const moderation = await checkText([
        text.title, text.artist, text.artist_dates, text.work_date, text.medium, text.accession, text.credit_line,
      ]);
      calls += moderation.calls;
      const flow: LabelFlowDisplay = {
        stage: 'read', fields: moderation.flagged ? {} : readFields(text), evidence: [], warnings: [],
        moderation: moderation.flagged ? 'flagged' : 'clear', promptVersion: PROMPT_VERSION, updatedAt: Date.now(),
      };
      await ctx.runMutation(internal.label.write, {
        scanId, deviceId: device._id, generation: scan.generation, labelFlow: moderation.flagged ? flow : { ...flow, rawOcr: text },
      });
      return flow;
    } catch (error) {
      if (error instanceof ConvexError && typeof error.data.calls === 'number') calls += error.data.calls;
      throw error;
    } finally {
      await ctx.runMutation(internal.spend.reconcile, { kind: 'tokenFactory', day, reserved: MAX_READ_CALLS, actual: calls });
    }
  }),
});

async function searchMuseumSite(ctx: ActionCtx, hosts: string[], pair: TavilyPair): Promise<TavilyEvidence | null> {
  const response = await searchWithCredit(ctx, {
    query: `"${pair.title.replace(/"/g, '')}" ${pair.artist}`, includeDomains: hosts, includeImages: true, maxResults: 5,
  });
  return response ? selectTavilyEvidence(response, pair, hosts) : null;
}

function applyImageCheck(flow: LabelFlow, check: ImageCheck): LabelFlow {
  if (!imageCheckPasses(check) || !flow.imageUrls?.includes(check.url)) return flow;
  const fields = { ...flow.fields };
  for (const name of ['title', 'artist'] as const) {
    const field = fields[name];
    if (field?.evidence === 'tavily') fields[name] = withEvidence(field, 'tavily+image');
  }
  return { ...flow, fields, evidence: evidenceSummary(fields) };
}

export async function moderateVerifiedFields(ctx: ActionCtx, fields: LabelFields, stored?: LabelFlow): Promise<'clear' | 'flagged'> {
  if (stored?.moderation === 'clear' && FIELD_NAMES.every((name) => fields[name]?.value === stored.fields[name]?.value)) {
    return 'clear';
  }
  const values = FIELD_NAMES.map((name) => fields[name]?.value);
  const reserved = process.env.MODERATION_MODEL && values.some(Boolean) ? MAX_MODERATION_CALLS : 0;
  const day = reserved ? await ctx.runMutation(internal.spend.reserve, { kind: 'tokenFactory', amount: reserved }) : undefined;
  let calls = 0;
  try {
    const result = await checkText(values);
    calls = result.calls;
    return result.flagged ? 'flagged' : 'clear';
  } finally {
    if (day !== undefined) await ctx.runMutation(internal.spend.reconcile, { kind: 'tokenFactory', day, reserved, actual: calls });
  }
}

export const verifyLabel = action({
  args: {
    scanId: v.id('scans'), fields: labelInput,
    imageCheck: v.optional(imageCheck),
  },
  returns: labelFlowDisplay,
  handler: async (ctx, args): Promise<LabelFlowDisplay> => withErrorReporting('label.verifyLabel', async () => {
    const { device, scan, venue } = await start(ctx, args.scanId);
    const stored = scan.labelFlow;
    const input: LabelInput = trimInput(args.fields);
    const unchanged = (name: LabelFieldName) => stored?.fields[name]?.value === input[name];
    const pairUnchanged = unchanged('title') && unchanged('artist');
    const objectUnchanged = pairUnchanged && unchanged('accession');
    const retained = (name: LabelFieldName) => {
      const previous = unchanged(name) ? stored?.fields[name] : undefined;
      if (!previous || !LOCKING_EVIDENCE.has(previous.evidence)) return undefined;
      // Wikidata identifies a named work; museum and image evidence also binds its accession.
      return (previous.evidence === 'wikidata' ? pairUnchanged : objectUnchanged) ? previous : undefined;
    };
    if (args.imageCheck && stored?.stage === 'verified' && FIELD_NAMES.every(unchanged) &&
      stored.imageUrls?.includes(args.imageCheck.url)) {
      // The phone compared one of the returned images; no new search or credit is needed.
      const upgraded = applyImageCheck(stored, args.imageCheck);
      if (upgraded !== stored) await ctx.runMutation(internal.label.write, {
        scanId: args.scanId, deviceId: device._id, generation: scan.generation, labelFlow: upgraded,
      });
      return displayLabelFlow(upgraded);
    }
    await limitDevice(ctx, 'labelVerify', device._id);
    const hosts = venue ? venueHosts(venue) : [];
    const fields: LabelFields = {};
    for (const name of FIELD_NAMES) {
      const value = input[name];
      if (value === undefined) continue;
      const previous = unchanged(name) ? stored?.fields[name] : undefined;
      fields[name] = retained(name) ?? labelField(value, 'ocr', previous?.confidence);
    }
    const museum = (name: LabelFieldName) => fields[name] !== undefined && MUSEUM_EVIDENCE.has(fields[name].evidence);
    const verified = (name: LabelFieldName) => fields[name] !== undefined && LOCKING_EVIDENCE.has(fields[name].evidence);
    let sourceUrl = objectUnchanged ? stored?.sourceUrl : undefined;
    let identityImageUrl = objectUnchanged ? stored?.identityImageUrl : undefined;
    let wikidataId = pairUnchanged ? stored?.wikidataId : undefined;
    let imageUrls = objectUnchanged ? stored?.imageUrls : undefined;

    const accession = venue ? await verifyAccession(venue, hosts, input) : null;
    if (accession) {
      for (const name of ['title', 'accession'] as const) {
        const field = fields[name];
        if (field) fields[name] = withEvidence(field, 'accession');
      }
      if (fields.artist && accession.fields.artist && personMatches(fields.artist.value, accession.fields.artist)) {
        fields.artist = withEvidence(fields.artist, 'accession');
      }
      for (const name of FIELD_NAMES) {
        const value = accession.fields[name];
        if (!fields[name] && value) fields[name] = labelField(value, 'accession');
      }
      sourceUrl = accession.sourceUrl;
      identityImageUrl = undefined;
    }

    let artist: WikidataEntity | null | undefined;
    let countryMatch: boolean | undefined;
    // A title/artist pair cannot bind a Wikidata ID to the specific museum object, even if its names agree.
    const museumIdentity = museum('title') || museum('artist') || museum('accession') || identityImageUrl !== undefined;
    if (museumIdentity) wikidataId = undefined;
    if (input.artist) {
      try {
        const pair = input.title && !museumIdentity ? await findWikidataPainting(input.title, input.artist) : null;
        if (pair) {
          wikidataId = pair.paintingId;
          for (const name of ['title', 'artist'] as const) {
            const field = fields[name];
            if (field && !museum(name)) fields[name] = withEvidence(field, 'wikidata');
          }
        }
        artist = pair?.artist ?? (await findArtist(input.artist));
        if (artist) countryMatch = await venueCountryMatch(artist, venue);
      } catch (error) {
        await reportBackendError(error, 'label.wikidata');
        console.warn('Wikidata unavailable; skipping the plausibility checks', error);
        artist = undefined;
      }
    }

    if (input.title && input.artist && hosts.length && !(verified('title') && verified('artist'))) {
      const evidence = await searchMuseumSite(ctx, hosts, { title: input.title, artist: input.artist, accession: input.accession });
      if (evidence) {
        for (const name of ['title', 'artist'] as const) {
          const field = fields[name];
          if (field && !museum(name)) fields[name] = withEvidence(field, 'tavily');
        }
        sourceUrl = evidence.sourceUrl;
        identityImageUrl = undefined;
        imageUrls = evidence.imageUrls;
      }
    }

    const warnings = artist === undefined ? [] : assessPlausibility({
      artistFound: artist !== null, lifespan: artist ? lifespan(artist) : undefined, date: input.date, venueCountryMatch: countryMatch,
    });
    if (warnings.includes('artist_not_found') && fields.artist && !museum('artist') && !retained('artist')) {
      fields.artist = withEvidence(fields.artist, 'weak');
    }
    if (warnings.includes('date_outside_lifespan') && fields.date && !museum('date')) fields.date = withEvidence(fields.date, 'weak');

    const moderation = await moderateVerifiedFields(ctx, fields, stored);
    let flow: LabelFlow = moderation === 'flagged' ? {
      stage: 'verified', fields: {}, evidence: [], warnings: [], moderation, promptVersion: stored?.promptVersion, updatedAt: Date.now(),
    } : {
      stage: 'verified', fields, evidence: evidenceSummary(fields), warnings,
      moderation, promptVersion: stored?.promptVersion, rawOcr: stored?.rawOcr,
      sourceUrl, identityImageUrl, wikidataId, imageUrls, updatedAt: Date.now(),
    };
    if (args.imageCheck) flow = applyImageCheck(flow, args.imageCheck);
    await ctx.runMutation(internal.label.write, { scanId: args.scanId, deviceId: device._id, generation: scan.generation, labelFlow: flow });
    return displayLabelFlow(flow);
  }),
});
