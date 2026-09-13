import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import model from '../shared/model/model-version.json';
import { api, internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import { completion, jsonLdPage, jsonResponse, metaPage, plainPage, tavilyMonet } from './lib/labelFixtures';
import { seedDevice, seedMuseum, seedScan, testVector } from './lib/testFactories';
import * as venueFetch from './lib/venueFetch';
import { harness, signIn } from './test.helpers';

const TOKEN_FACTORY = 'https://api.tokenfactory.nebius.com/v1/chat/completions';
const TAVILY = 'https://api.tavily.com/search';
const VISION_MODEL = 'moonshotai/Kimi-K2.6';
const MODERATION_MODEL = 'nvidia/Nemotron-3_5-Lightning';
const IMAGE = 'AAAA'.repeat(1000);
const DESCRIPTION = 'Pond surface covered with pale lily pads and pink blossoms, no horizon, soft blues and greens';
const described = { description: DESCRIPTION, artist_guess: 'Claude Monet', confidence: 0.9 };
const MET_PAGE = 'https://www.metmuseum.org/art/collection/search/437137';
const MET_PAGE_2 = 'https://www.metmuseum.org/art/collection/search/438008';
const MET_PAGE_3 = 'https://www.metmuseum.org/art/collection/search/437127';
const MET_IMAGE = 'https://collectionapi.metmuseum.org/api/collection/v1/iiif/437137/2018391/main-image';
const MET_IMAGE_2 = MET_IMAGE.replace('437137', '438008');
const SECOND_PAGE = jsonLdPage.replaceAll('437137', '438008').replaceAll('1998.325.2', '1983.532');
const waterLilies = {
  title: 'Water Lilies', artist: 'Claude Monet', date: '1919', accession: '1998.325.2', medium: 'Oil on canvas',
  creditLine: 'Gift of Louise Reinhardt Smith, 1983',
};

type Route = (url: URL, init?: RequestInit) => Response | undefined;
const fetchMock = vi.fn<typeof fetch>();
let routes: Route[] = [];
let venuePages: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  routes = [];
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    for (const route of routes) {
      const response = route(url, init);
      if (response) return response;
    }
    if (url.href === TOKEN_FACTORY && JSON.parse(String(init?.body)).model === MODERATION_MODEL) return completion({ flagged: false });
    throw new Error(`Unexpected fetch ${url.href}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('NEBIUS_API_KEY', 'nebius-test');
  vi.stubEnv('TAVILY_API_KEY', 'tvly-test');
  vi.stubEnv('LABEL_VL_MODEL', VISION_MODEL);
  vi.stubEnv('MODERATION_MODEL', MODERATION_MODEL);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  venuePages = vi.spyOn(venueFetch, 'fetchVenuePage');
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function vision(handler: () => Response = () => completion(described)) {
  routes.push((url, init) => (url.href === TOKEN_FACTORY && JSON.parse(String(init?.body)).model === VISION_MODEL ? handler() : undefined));
}
function tavily(response: unknown) {
  routes.push((url) => (url.href === TAVILY ? jsonResponse(response) : undefined));
}
function page(href: string, html: string, init?: ResponseInit) {
  routes.push((url) => (url.href === href ? new Response(html, init) : undefined));
}
const calls = (prefix: string) => fetchMock.mock.calls.filter(([url]) => String(url).startsWith(prefix));
const venueFetches = () => fetchMock.mock.calls.filter(([url]) => new URL(String(url)).host.endsWith('metmuseum.org'));

type MuseumOverrides = Partial<Omit<Doc<'museums'>, '_id' | '_creationTime'>>;
const MET: MuseumOverrides = { website: 'https://www.metmuseum.org/' };

async function fixture(venue: MuseumOverrides | null = MET) {
  const t = harness();
  const user = await seedDevice(t);
  const venueId = venue ? await t.run((ctx) => seedMuseum(ctx, venue)) : undefined;
  const scanId = await t.run((ctx) => seedScan(ctx, { deviceId: user.deviceId, venueId }));
  const stored = async () => (await t.run((ctx) => ctx.db.get(scanId)))!;
  const spend = async () => (await t.run((ctx) => ctx.db.query('dailySpend').collect()))[0];
  const search = (imageBase64 = IMAGE) => user.as.action(api.museumSearch.searchMuseumSite, { scanId, imageBase64 });
  return { t, user, venueId, scanId, stored, spend, search };
}

function metPages() {
  page(MET_PAGE, jsonLdPage);
  page(MET_PAGE_2, SECOND_PAGE);
  page(MET_PAGE_3, plainPage);
}

function pauseNextFetch(response: Response) {
  let begin!: () => void;
  let resume!: () => void;
  const started = new Promise<void>((resolve) => { begin = resolve; });
  const resumed = new Promise<void>((resolve) => { resume = resolve; });
  fetchMock.mockImplementationOnce(async () => {
    begin();
    await resumed;
    return response;
  });
  return { started, resume };
}

describe('searchMuseumSite', () => {
  it('describes the crop, searches the venue hosts, extracts candidate pages, and settles spend', async () => {
    const { stored, spend, search } = await fixture();
    vision();
    tavily(tavilyMonet);
    metPages();
    const result = await search();
    expect(result).toEqual({
      stage: 'candidates', promptVersion: 'describe-v1', updatedAt: expect.any(Number),
      candidates: [
        { sourceUrl: MET_PAGE, fields: waterLilies, imageUrls: [MET_IMAGE] },
        { sourceUrl: MET_PAGE_2, fields: { ...waterLilies, accession: '1983.532' }, imageUrls: [MET_IMAGE_2] },
      ],
    });
    const scan = await stored();
    expect(scan.museumSearch).toEqual(result);
    expect(JSON.stringify(scan)).not.toContain(DESCRIPTION);
    expect(JSON.stringify(scan)).not.toContain('lily pads');
    expect(await spend()).toMatchObject({ tokenFactoryCalls: 1, tavilyCredits: 1 });
    const requests = calls(TOKEN_FACTORY).map(([, init]) => JSON.parse(String(init?.body)));
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      model: VISION_MODEL, temperature: 0, max_tokens: 256, chat_template_kwargs: { thinking: false },
      response_format: { type: 'json_schema', json_schema: { name: 'describe', strict: true } },
    });
    expect(requests[0].messages[0].content).toContain('never name the work');
    expect(requests[0].messages[1].content[1]).toEqual({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${IMAGE}` } });
    expect(JSON.parse(String(calls(TAVILY)[0][1]?.body))).toMatchObject({
      query: `${DESCRIPTION} Claude Monet`, include_domains: ['metmuseum.org'], include_domains_mode: 'filter',
      include_images: false, max_results: 5, search_depth: 'basic',
    });
    expect(venueFetches().map(([url]) => String(url))).toEqual([MET_PAGE, MET_PAGE_2, MET_PAGE_3]);
    expect(venuePages).toHaveBeenCalledTimes(3);
  });

  it('records no candidates when the search finds nothing usable', async () => {
    const { stored, spend, search } = await fixture();
    vision();
    tavily({ results: [], usage: { credits: 1 } });
    const result = await search();
    expect(result).toEqual({ stage: 'none', reason: 'no_candidates', promptVersion: 'describe-v1', updatedAt: expect.any(Number) });
    expect((await stored()).museumSearch).toEqual(result);
    expect(await spend()).toMatchObject({ tokenFactoryCalls: 1, tavilyCredits: 1 });
  });

  it('drops results on other hosts, shop and audio paths, pages without metadata, and pages without an image', async () => {
    const { search } = await fixture();
    vision();
    const result = (url: string, score: number) => ({ url, title: 'Water Lilies', content: 'Claude Monet', score });
    tavily({ results: [
      result('https://www.moma.org/collection/works/79802', 0.99),
      result('https://customprints.metmuseum.org/detail/489058/monet-water-lilies', 0.98),
      result('https://www.metmuseum.org/audio/guide/1', 0.97),
      result('https://www.metmuseum.org/art/collection/search/1', 0.96),
      result('https://www.metmuseum.org/art/collection/search/2', 0.95),
    ], usage: { credits: 1 } });
    page('https://www.metmuseum.org/art/collection/search/1', metaPage.replace('<meta name="author" content="Edward Hopper">', ''));
    page('https://www.metmuseum.org/art/collection/search/2', jsonLdPage.replace(`"image":"${MET_IMAGE}"`, '"image":[]').replace(/<meta property="og:image"[^>]*>/, ''));
    expect(await search()).toMatchObject({ stage: 'none', reason: 'no_candidates' });
    expect(venueFetches().map(([url]) => String(url))).toEqual([
      'https://www.metmuseum.org/art/collection/search/1', 'https://www.metmuseum.org/art/collection/search/2',
    ]);
    expect(venuePages).toHaveBeenCalledTimes(2);
  });

  it('refuses the flag off, other devices, ineligible scans, venues without a site or opted out, and bad images before any call', async () => {
    const { t, user, venueId, scanId, stored, spend, search } = await fixture();
    const rejects = (code: string, run = search) => expect(run()).rejects.toMatchObject({ data: { code } });
    vi.stubEnv('FLAG_MUSEUM_SEARCH', 'off');
    await rejects('feature_off');
    vi.stubEnv('FLAG_MUSEUM_SEARCH', 'on');
    const other = await seedDevice(t);
    await rejects('invalid_scan', () => other.as.action(api.museumSearch.searchMuseumSite, { scanId, imageBase64: IMAGE }));
    const unregistered = await signIn(t);
    await rejects('device_not_registered', () => unregistered.as.action(api.museumSearch.searchMuseumSite, { scanId, imageBase64: IMAGE }));
    await rejects('unauthenticated', () => t.action(api.museumSearch.searchMuseumSite, { scanId, imageBase64: IMAGE }));
    await t.run((ctx) => ctx.db.patch(scanId, { outcome: 'confident' }));
    await rejects('invalid_scan');
    await t.run((ctx) => ctx.db.patch(scanId, { outcome: 'miss', status: 'pending' }));
    await rejects('invalid_scan');
    await t.run((ctx) => ctx.db.patch(scanId, { status: 'identified', venueId: undefined }));
    await rejects('invalid_scan');
    await t.run((ctx) => ctx.db.patch(scanId, { venueId }));
    await t.run((ctx) => ctx.db.patch(venueId!, { website: undefined }));
    await rejects('no_venue_site');
    await t.run((ctx) => ctx.db.patch(venueId!, { website: 'https://www.metmuseum.org/' }));
    const optOutId = await t.run((ctx) => ctx.db.insert('optOuts', { venueId, requester: 'museum', receivedAt: Date.now() }));
    await rejects('venue_opted_out');
    await t.run((ctx) => ctx.db.delete(optOutId));
    await rejects('bad_image', () => search('not base64!'));
    await rejects('image_too_large', () => search('A'.repeat(2_000_004)));
    vi.stubEnv('LABEL_VL_MODEL', '');
    await rejects('model_unconfigured');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await spend()).toBeUndefined();
    expect((await stored()).museumSearch).toBeUndefined();
    expect(user.deviceId).toBeDefined();
  });

  it.each([
    ['DAILY_TOKEN_FACTORY_CALL_CAP', '1'],
    ['DAILY_TAVILY_CREDIT_CAP', '0'],
  ])('records a cap result without any provider call and leaves both counters unchanged at %s=%s', async (name, value) => {
    const { stored, spend, search } = await fixture();
    vi.stubEnv(name, value);
    const result = await search();
    expect(result).toEqual({ stage: 'none', reason: 'cap', updatedAt: expect.any(Number) });
    expect((await stored()).museumSearch).toEqual(result);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await spend()).toBeUndefined();
  });

  it('refunds the unused search credit and records only the attempted model calls when the description fails', async () => {
    const { stored, spend, search } = await fixture();
    vision(() => new Response('busy', { status: 503, headers: { 'retry-after': '0' } }));
    await expect(search()).rejects.toMatchObject({ data: { code: 'model_error', reason: 'http_503', calls: 2 } });
    expect(calls(TAVILY)).toHaveLength(0);
    expect((await stored()).museumSearch).toBeUndefined();
    expect(await spend()).toMatchObject({ tokenFactoryCalls: 2, tavilyCredits: 0 });
  });

  it('rejects a description outside the schema after one call and refunds the rest', async () => {
    const { spend, search } = await fixture();
    vision(() => completion({ description: '', artist_guess: null, confidence: 0 }));
    await expect(search()).rejects.toMatchObject({ data: { code: 'model_error', reason: 'schema', calls: 1 } });
    expect(await spend()).toMatchObject({ tokenFactoryCalls: 1, tavilyCredits: 0 });
  });

  it('retains the search credit after an ambiguous search failure', async () => {
    const { stored, spend, search } = await fixture();
    vision();
    routes.push((url) => {
      if (url.href === TAVILY) throw new Error('timeout');
      return undefined;
    });
    await expect(search()).rejects.toMatchObject({ data: { code: 'search_error', reason: 'fetch_failed' } });
    expect(await spend()).toMatchObject({ tokenFactoryCalls: 1, tavilyCredits: 1 });
    expect((await stored()).museumSearch).toBeUndefined();
  });

  it('refunds the credit when the search client is unconfigured and retains it when usage is unreported', async () => {
    const { spend, search } = await fixture();
    vision();
    vi.stubEnv('TAVILY_API_KEY', '');
    await expect(search()).rejects.toMatchObject({ data: { code: 'search_unconfigured' } });
    expect(await spend()).toMatchObject({ tokenFactoryCalls: 1, tavilyCredits: 0 });
    vi.stubEnv('TAVILY_API_KEY', 'tvly-test');
    tavily({ results: [] });
    await expect(search()).resolves.toMatchObject({ stage: 'none', reason: 'no_candidates' });
    expect(await spend()).toMatchObject({ tokenFactoryCalls: 2, tavilyCredits: 1 });
  });

  it('limits a device to ten attempts per hour, each an exhibition search plus a description search', async () => {
    const { user, scanId, search } = await fixture();
    vision();
    tavily({ results: [], usage: { credits: 1 } });
    for (let i = 0; i < 10; i++) {
      await user.as.action(api.museumSearch.searchExhibitions, { scanId });
      await search();
    }
    await expect(search()).rejects.toMatchObject({ data: { code: 'rate_limited', name: 'museumSearch' } });
    expect(calls(TAVILY)).toHaveLength(20);
  });

  it.each(['candidates', 'none'])('preserves a newer confirmation when an older search finishes with %s', async (stage) => {
    const { user, scanId, stored, spend, search } = await fixture();
    const pending = pauseNextFetch(completion(described));
    vision();
    tavily(tavilyMonet);
    metPages();
    const obsolete = expect(search()).rejects.toMatchObject({ data: { code: 'search_superseded' } });
    await pending.started;
    const latest = await search();
    if (latest.stage !== 'candidates') throw new Error('expected candidates');
    const candidate = latest.candidates[0];
    await user.as.action(api.museumSearch.confirmSearchCandidate, {
      scanId, sourceUrl: candidate.sourceUrl,
      imageCheck: { url: candidate.imageUrls[0], cosine: 0.9, homographyValid: true },
    });
    const confirmed = await stored();
    expect(confirmed.museumSearch?.stage).toBe('confirmed');
    if (stage === 'none') {
      routes = [];
      tavily({ results: [], usage: { credits: 1 } });
    }
    pending.resume();
    await obsolete;
    expect(await stored()).toEqual(confirmed);
    expect(await spend()).toMatchObject({ tokenFactoryCalls: 3, tavilyCredits: 2 });
  });

  it('preserves the latest search result when a capped retry supersedes an in-flight search', async () => {
    const { stored, spend, search } = await fixture();
    const pending = pauseNextFetch(completion(described));
    tavily({ results: [], usage: { credits: 1 } });
    const obsolete = expect(search()).rejects.toMatchObject({ data: { code: 'search_superseded' } });
    await pending.started;
    vi.stubEnv('DAILY_TAVILY_CREDIT_CAP', '1');
    expect(await search()).toMatchObject({ stage: 'none', reason: 'cap' });
    const latest = await stored();
    pending.resume();
    await obsolete;
    expect(await stored()).toEqual(latest);
    expect(await spend()).toMatchObject({ tokenFactoryCalls: 1, tavilyCredits: 1 });
  });

  it('rejects an obsolete result after the scan restarts and still settles spend', async () => {
    const { t, user, scanId, stored, spend, search } = await fixture();
    const original = await stored();
    let beginFetch!: () => void;
    let resumeFetch!: () => void;
    const started = new Promise<void>((resolve) => { beginFetch = resolve; });
    const resumed = new Promise<void>((resolve) => { resumeFetch = resolve; });
    fetchMock.mockImplementationOnce(async () => {
      beginFetch();
      await resumed;
      return completion(described);
    });
    tavily({ results: [], usage: { credits: 1 } });
    const rejected = expect(search()).rejects.toMatchObject({ data: { code: 'scan_restarted' } });
    await started;
    await t.run((ctx) => ctx.db.patch(scanId, { status: 'failed' }));
    const restarted = await t.mutation(internal.scans.create, {
      deviceId: user.deviceId, localId: original.localId, modelVersion: model.modelVersion,
      vector: testVector(), capturedAt: original.capturedAt,
    });
    expect(restarted.scan).toMatchObject({ _id: scanId, generation: 1 });
    resumeFetch();
    await rejected;
    expect((await stored()).museumSearch).toBeUndefined();
    expect(await spend()).toMatchObject({ tokenFactoryCalls: 1, tavilyCredits: 1 });
  });
});

describe('confirmSearchCandidate', () => {
  const pass = (url: string) => ({ url, cosine: 0.9, homographyValid: true });

  async function searched() {
    const f = await fixture();
    vision();
    tavily(tavilyMonet);
    metPages();
    const result = await f.search();
    if (result.stage !== 'candidates') throw new Error('expected candidates');
    routes = [];
    const confirm = (sourceUrl: string, imageCheck: { url: string; cosine: number; homographyValid: boolean }) =>
      f.user.as.action(api.museumSearch.confirmSearchCandidate, { scanId: f.scanId, sourceUrl, imageCheck });
    return { ...f, candidates: result.candidates, confirm };
  }

  it('locks title and artist with tavily+image and the other page fields with tavily, and records the selection', async () => {
    const { stored, spend, candidates, confirm } = await searched();
    const [first] = candidates;
    const result = await confirm(first.sourceUrl, pass(first.imageUrls[0]));
    expect(result).toEqual({
      stage: 'verified', evidence: ['tavily+image', 'tavily'], warnings: [], moderation: 'clear',
      sourceUrl: MET_PAGE, imageUrls: [MET_IMAGE], updatedAt: expect.any(Number),
      fields: {
        title: { value: 'Water Lilies', evidence: 'tavily+image', locked: true },
        artist: { value: 'Claude Monet', evidence: 'tavily+image', locked: true },
        date: { value: '1919', evidence: 'tavily', locked: true },
        accession: { value: '1998.325.2', evidence: 'tavily', locked: true },
        medium: { value: 'Oil on canvas', evidence: 'tavily', locked: true },
        creditLine: { value: 'Gift of Louise Reinhardt Smith, 1983', evidence: 'tavily', locked: true },
      },
    });
    const scan = await stored();
    expect(scan.labelFlow).toEqual(result);
    expect(scan.museumSearch).toEqual({
      stage: 'confirmed', candidates, selected: { sourceUrl: MET_PAGE, imageUrl: MET_IMAGE },
      promptVersion: 'describe-v1', updatedAt: result.updatedAt,
    });
    // 04.07's contribute precondition on the stored scan.
    expect(scan.labelFlow?.stage === 'verified' && scan.labelFlow.moderation !== 'flagged').toBe(true);
    expect(await spend()).toMatchObject({ tokenFactoryCalls: 2, tavilyCredits: 1 });
    expect(calls(TAVILY)).toHaveLength(1);
    const moderation = JSON.parse(String(calls(TOKEN_FACTORY)[1][1]?.body));
    expect(moderation.model).toBe(MODERATION_MODEL);
    expect(JSON.parse(moderation.messages[1].content).input).toContain('Gift of Louise Reinhardt Smith, 1983');
  });

  it.each(['candidates', 'confirmed'] as const)('rejects an unknown page or image while %s', async (stage) => {
    const { candidates, confirm } = await searched();
    const [first] = candidates;
    if (stage === 'confirmed') await confirm(first.sourceUrl, pass(first.imageUrls[0]));
    await expect(confirm('https://www.metmuseum.org/art/collection/search/999', pass(first.imageUrls[0])))
      .rejects.toMatchObject({ data: { code: 'unknown_candidate' } });
    await expect(confirm(first.sourceUrl, pass('https://collectionapi.metmuseum.org/other.jpg')))
      .rejects.toMatchObject({ data: { code: 'unknown_candidate' } });
    await expect(confirm(first.sourceUrl, pass(MET_IMAGE_2))).rejects.toMatchObject({ data: { code: 'unknown_candidate' } });
  });

  it('rejects a confirmation for a scan without a search', async () => {
    const { user, scanId } = await fixture();
    await expect(user.as.action(api.museumSearch.confirmSearchCandidate, { scanId, sourceUrl: MET_PAGE, imageCheck: pass(MET_IMAGE) }))
      .rejects.toMatchObject({ data: { code: 'unknown_candidate' } });
    vi.stubEnv('FLAG_MUSEUM_SEARCH', 'off');
    await expect(user.as.action(api.museumSearch.confirmSearchCandidate, { scanId, sourceUrl: MET_PAGE, imageCheck: pass(MET_IMAGE) }))
      .rejects.toMatchObject({ data: { code: 'feature_off' } });
  });

  it.each([
    { cosine: NaN, homographyValid: true }, { cosine: 1.01, homographyValid: true },
    { cosine: 0.5, homographyValid: true }, { cosine: 0.99, homographyValid: false },
  ])('rejects the image check %j', async (check) => {
    const { stored, candidates, confirm } = await searched();
    const [first] = candidates;
    await expect(confirm(first.sourceUrl, { url: first.imageUrls[0], ...check })).rejects.toMatchObject({ data: { code: 'image_mismatch' } });
    const scan = await stored();
    expect(scan.labelFlow).toBeUndefined();
    expect(scan.museumSearch?.stage).toBe('candidates');
  });

  it('returns the stored result on a retry of the same page and image without another call or write', async () => {
    const { stored, spend, candidates, confirm } = await searched();
    const [first] = candidates;
    const result = await confirm(first.sourceUrl, pass(first.imageUrls[0]));
    const scan = await stored();
    const before = fetchMock.mock.calls.length;
    const spent = await spend();
    await new Promise((resolve) => setTimeout(resolve, 2));
    expect(await confirm(first.sourceUrl, pass(first.imageUrls[0]))).toEqual(result);
    expect(await stored()).toEqual(scan);
    expect(fetchMock.mock.calls.length).toBe(before);
    expect(await spend()).toEqual(spent);
  });

  it('clears flagged fields and returns the flagged result again on a retry', async () => {
    const { stored, spend, candidates, confirm } = await searched();
    routes.push((url, init) => (
      url.href === TOKEN_FACTORY && JSON.parse(String(init?.body)).model === MODERATION_MODEL ? completion({ flagged: true }) : undefined
    ));
    const [first] = candidates;
    const result = await confirm(first.sourceUrl, pass(first.imageUrls[0]));
    expect(result).toEqual({
      stage: 'verified', fields: {}, evidence: [], warnings: [], moderation: 'flagged',
      sourceUrl: MET_PAGE, imageUrls: [MET_IMAGE], updatedAt: expect.any(Number),
    });
    const scan = await stored();
    expect(scan.labelFlow).toEqual(result);
    expect(scan.museumSearch).toMatchObject({ stage: 'confirmed', selected: { sourceUrl: MET_PAGE, imageUrl: MET_IMAGE } });
    const before = fetchMock.mock.calls.length;
    const spent = await spend();
    await new Promise((resolve) => setTimeout(resolve, 2));
    expect(await confirm(first.sourceUrl, pass(first.imageUrls[0]))).toEqual(result);
    expect(await stored()).toEqual(scan);
    expect(fetchMock.mock.calls.length).toBe(before);
    expect(await spend()).toEqual(spent);
  });

  it('replaces the selection when another retained candidate is confirmed, without another search', async () => {
    const { stored, candidates, confirm } = await searched();
    const [first, second] = candidates;
    await confirm(first.sourceUrl, pass(first.imageUrls[0]));
    const result = await confirm(second.sourceUrl, pass(second.imageUrls[0]));
    expect(result).toMatchObject({
      sourceUrl: MET_PAGE_2, imageUrls: [MET_IMAGE_2],
      fields: { title: { evidence: 'tavily+image' }, accession: { value: '1983.532', evidence: 'tavily', locked: true } },
    });
    const scan = await stored();
    expect(scan.labelFlow).toEqual(result);
    expect(scan.museumSearch).toEqual({
      stage: 'confirmed', candidates, selected: { sourceUrl: MET_PAGE_2, imageUrl: MET_IMAGE_2 },
      promptVersion: 'describe-v1', updatedAt: result.updatedAt,
    });
    expect(calls(TAVILY)).toHaveLength(1);
    expect(calls(TOKEN_FACTORY)).toHaveLength(3);
  });

  it.each([false, true])('limits paid confirmations while preserving free retries (flagged=%s)', async (flagged) => {
    const { stored, spend, candidates, confirm } = await searched();
    routes.push((url) => url.href === TOKEN_FACTORY ? completion({ flagged }) : undefined);
    for (let i = 0; i < 60; i++) {
      const candidate = candidates[i % 2];
      await confirm(candidate.sourceUrl, pass(candidate.imageUrls[0]));
    }
    const scan = await stored();
    const spent = await spend();
    expect(spent).toMatchObject({ tokenFactoryCalls: 61, tavilyCredits: 1 });
    await expect(confirm(candidates[0].sourceUrl, pass(candidates[0].imageUrls[0])))
      .rejects.toMatchObject({ data: { code: 'rate_limited', name: 'labelVerify' } });
    expect(await confirm(candidates[1].sourceUrl, pass(candidates[1].imageUrls[0]))).toEqual(scan.labelFlow);
    expect(await stored()).toEqual(scan);
    expect(await spend()).toEqual(spent);
    expect(calls(TOKEN_FACTORY)).toHaveLength(61);
  });

  it('invalidates an in-flight retry when a retained candidate is confirmed', async () => {
    const { stored, spend, candidates, confirm, search } = await searched();
    const pending = pauseNextFetch(completion(described));
    tavily({ results: [], usage: { credits: 1 } });
    const obsolete = expect(search()).rejects.toMatchObject({ data: { code: 'search_superseded' } });
    await pending.started;
    const candidate = candidates[0];
    await confirm(candidate.sourceUrl, pass(candidate.imageUrls[0]));
    const confirmed = await stored();
    pending.resume();
    await obsolete;
    expect(await stored()).toEqual(confirmed);
    expect(await spend()).toMatchObject({ tokenFactoryCalls: 3, tavilyCredits: 2 });
  });

  it('allows a new manual search after confirmation', async () => {
    const { stored, spend, candidates, confirm, search } = await searched();
    const candidate = candidates[0];
    await confirm(candidate.sourceUrl, pass(candidate.imageUrls[0]));
    vision();
    tavily({ results: [], usage: { credits: 1 } });
    const result = await search();
    expect(result).toMatchObject({ stage: 'none', reason: 'no_candidates' });
    expect((await stored()).museumSearch).toEqual(result);
    expect(await spend()).toMatchObject({ tokenFactoryCalls: 3, tavilyCredits: 2 });
  });

  it('rejects a stale confirmation after the scan restarts', async () => {
    const { t, user, scanId, stored, candidates, confirm } = await searched();
    const original = await stored();
    let beginFetch!: () => void;
    let resumeFetch!: () => void;
    const started = new Promise<void>((resolve) => { beginFetch = resolve; });
    const resumed = new Promise<void>((resolve) => { resumeFetch = resolve; });
    fetchMock.mockImplementationOnce(async () => {
      beginFetch();
      await resumed;
      return completion({ flagged: false });
    });
    const [first] = candidates;
    const rejected = expect(confirm(first.sourceUrl, pass(first.imageUrls[0]))).rejects.toMatchObject({ data: { code: 'scan_restarted' } });
    await started;
    await t.run((ctx) => ctx.db.patch(scanId, { status: 'failed' }));
    await t.mutation(internal.scans.create, {
      deviceId: user.deviceId, localId: original.localId, modelVersion: model.modelVersion,
      vector: testVector(), capturedAt: original.capturedAt,
    });
    resumeFetch();
    await rejected;
    expect((await stored()).labelFlow).toBeUndefined();
  });
});

describe('live exhibition lookup', () => {
  const url = 'https://www.metmuseum.org/exhibitions/colour';
  const blue = 'https://www.metmuseum.org/blue.jpg';
  const red = 'https://www.metmuseum.org/red.jpg';
  const results = { results: [{ url, title: 'A Century of Colour', content: 'Two paintings.', score: 0.9, images: [red, blue] }], usage: { credits: 1 } };
  const exhibitHtml = `<title>A Century of Colour</title><script type="application/ld+json">${JSON.stringify([
    { '@type': 'Painting', name: 'Red', creator: 'First Artist', image: red },
    { '@type': 'Painting', name: 'Blue', creator: 'Second Artist', image: blue },
  ])}</script>`;

  async function exhibitionFixture() {
    const f = await fixture({ ...MET, name: 'The Metropolitan Museum of Art' });
    const search = () => f.user.as.action(api.museumSearch.searchExhibitions, { scanId: f.scanId });
    const confirm = (imageUrl = blue) => f.user.as.action(api.museumSearch.confirmSearchCandidate, {
      scanId: f.scanId, sourceUrl: url, imageCheck: { url: imageUrl, cosine: 0.9, homographyValid: true },
    });
    return { ...f, search, confirm };
  }

  it('makes one museum-scoped search with images, retains the source content, and sends no photo to a model', async () => {
    const { search, stored, spend } = await exhibitionFixture();
    tavily(results);
    const state = await search();
    expect(state).toMatchObject({ stage: 'exhibitions', candidates: [{ sourceUrl: url, fields: {}, imageUrls: [red, blue],
      exhibition: { title: 'A Century of Colour', content: 'Two paintings.' } }] });
    expect((await stored()).museumSearch).toEqual(state);
    expect(JSON.parse(String(calls(TAVILY)[0][1]?.body))).toMatchObject({
      query: 'The Metropolitan Museum of Art current exhibitions', include_images: true, include_domains: ['metmuseum.org'],
    });
    expect(calls(TAVILY)).toHaveLength(1);
    expect(calls(TOKEN_FACTORY)).toHaveLength(0);
    expect(venueFetches()).toHaveLength(0);
    expect(await spend()).toMatchObject({ tavilyCredits: 1, tokenFactoryCalls: 0 });
  });

  it('confirms the second image with only its own metadata and returns retries without another fetch', async () => {
    const { search, confirm, stored } = await exhibitionFixture();
    tavily(results);
    page(url, exhibitHtml);
    await search();
    const flow = await confirm();
    expect(flow).toMatchObject({ identityImageUrl: blue, sourceUrl: url, imageUrls: [blue], evidence: ['tavily+image'],
      fields: { title: { value: 'Blue', evidence: 'tavily+image' }, artist: { value: 'Second Artist', evidence: 'tavily+image' } } });
    expect((await stored()).museumSearch).toMatchObject({ stage: 'confirmed', selected: { sourceUrl: url, imageUrl: blue } });
    const count = fetchMock.mock.calls.length;
    expect(await confirm()).toEqual(flow);
    expect(fetchMock).toHaveBeenCalledTimes(count);
  });

  it('refuses to identify a matching image from a generic exhibition title and records the outcome', async () => {
    const { search, confirm, stored } = await exhibitionFixture();
    tavily(results);
    page(url, '<meta property="og:title" content="A Century of Colour"><meta name="author" content="Museum curator">');
    await search();
    await expect(confirm()).rejects.toMatchObject({ data: { code: 'identity_unresolved' } });
    expect((await stored()).labelFlow).toBeUndefined();
    expect((await stored()).museumSearch).toMatchObject({ stage: 'none', reason: 'identity_unresolved' });
    expect(calls(TOKEN_FACTORY)).toHaveLength(0);
    // Reopening the scan finds a finished search, so the page is not fetched again.
    const fetches = venueFetches().length;
    await expect(confirm()).rejects.toMatchObject({ data: { code: 'unknown_candidate' } });
    expect(venueFetches()).toHaveLength(fetches);
  });

  it('keeps the exhibition candidates when the page cannot be fetched, so a later confirmation retries', async () => {
    const { search, confirm, stored } = await exhibitionFixture();
    tavily(results);
    page(url, 'slow down', { status: 429 });
    await search();
    await expect(confirm()).rejects.toMatchObject({ data: { code: 'page_unavailable' } });
    expect((await stored()).museumSearch).toMatchObject({ stage: 'exhibitions' });
    expect((await stored()).labelFlow).toBeUndefined();
    routes = [];
    page(url, exhibitHtml);
    expect(await confirm()).toMatchObject({ fields: { title: { value: 'Blue' }, artist: { value: 'Second Artist' } } });
  });

  it('resolves only the matched image caption, grounds model fields in it, and accounts for both extraction and moderation', async () => {
    const { search, confirm, spend } = await exhibitionFixture();
    vi.stubEnv('DOCENT_MODEL', 'caption-model');
    tavily(results);
    page(url, `<figure><img src="${red}"><figcaption>First Artist, Red.</figcaption></figure>` +
      `<figure><img src="${blue}"><figcaption>Second Artist, Blue, 2020.</figcaption></figure>`);
    routes.push((url, init) => url.href === TOKEN_FACTORY && JSON.parse(String(init?.body)).model === 'caption-model'
      ? completion({ title: 'Blue', artist: 'Second Artist' }) : undefined);
    await search();
    expect(await confirm()).toMatchObject({ fields: { title: { value: 'Blue' }, artist: { value: 'Second Artist' } } });
    const request = JSON.parse(String(calls(TOKEN_FACTORY)[0][1]?.body));
    expect(JSON.parse(request.messages[1].content)).toEqual({ caption: 'Second Artist, Blue, 2020.' });
    expect(await spend()).toMatchObject({ tavilyCredits: 1, tokenFactoryCalls: 2 });
  });

  it('retains image-specific evidence when the visitor shares unchanged fields', async () => {
    const { user, scanId, search, confirm } = await exhibitionFixture();
    tavily(results);
    page(url, exhibitHtml);
    await search();
    await confirm();
    const flow = await user.as.action(api.label.verifyLabel, { scanId, fields: { title: 'Blue', artist: 'Second Artist' } });
    expect(flow).toMatchObject({ identityImageUrl: blue, sourceUrl: url,
      fields: { title: { evidence: 'tavily+image' }, artist: { evidence: 'tavily+image' } } });
    expect(flow.wikidataId).toBeUndefined();
  });

  it('applies the daily cap before any request', async () => {
    const { search, stored, spend } = await exhibitionFixture();
    vi.stubEnv('DAILY_TAVILY_CREDIT_CAP', '0');
    expect(await search()).toMatchObject({ stage: 'none', reason: 'cap' });
    expect((await stored()).museumSearch).toMatchObject({ stage: 'none', reason: 'cap' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await spend()).toBeUndefined();
  });

  it('refuses unowned scans, opted-out venues, and the disabled feature before searching', async () => {
    const { t, user, scanId, venueId, search } = await exhibitionFixture();
    const other = await seedDevice(t);
    await expect(other.as.action(api.museumSearch.searchExhibitions, { scanId })).rejects.toMatchObject({ data: { code: 'invalid_scan' } });
    vi.stubEnv('FLAG_MUSEUM_SEARCH', 'off');
    await expect(search()).rejects.toMatchObject({ data: { code: 'feature_off' } });
    vi.stubEnv('FLAG_MUSEUM_SEARCH', 'on');
    await t.run((ctx) => ctx.db.insert('optOuts', { venueId, requester: 'museum', receivedAt: Date.now() }));
    await expect(user.as.action(api.museumSearch.searchExhibitions, { scanId })).rejects.toMatchObject({ data: { code: 'venue_opted_out' } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps a newer confirmed result when an old exhibition request finishes', async () => {
    const { search, confirm, stored } = await exhibitionFixture();
    const pending = pauseNextFetch(jsonResponse(results));
    tavily(results);
    page(url, exhibitHtml);
    const obsolete = expect(search()).rejects.toMatchObject({ data: { code: 'search_superseded' } });
    await pending.started;
    await search();
    await confirm();
    const latest = await stored();
    pending.resume();
    await obsolete;
    expect(await stored()).toEqual(latest);
  });
});
