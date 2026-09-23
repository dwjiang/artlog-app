import { guideOpening, guideResearch } from '../shared/audio/guide';
import { guideBodyFixture } from '../shared/audio/guide-fixtures';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { completion, jsonResponse } from './lib/labelFixtures';
import { seedArtworkWithObject, seedDevice, seedMuseum } from './lib/testFactories';
import { harness, type Harness } from './test.helpers';

const TOKEN_FACTORY = 'https://api.tokenfactory.nebius.com/v1/chat/completions';
const TAVILY = 'https://api.tavily.com/search';
const WIKIDATA = 'https://www.wikidata.org/w/api.php';
const PAGE = 'https://www.metmuseum.org/art/collection/search/436535';
const WIKIDATA_PAGE = 'https://www.wikidata.org/wiki/Q18689458';
const SEARCH_HIT = 'https://www.metmuseum.org/art/collection/search/436535?lang=it';
const FACT_SHEET_MODEL = 'nvidia/nemotron-3-super-120b-a12b';
const DOCENT_MODEL = 'nvidia/Nemotron-3_5-Lightning';

const ownerPage = `<!doctype html><html><head><title>Wheat Field with Cypresses</title><script>var x = 1;</script></head>
<body><nav>Visit Exhibitions Shop</nav><main><h1>Wheat Field with Cypresses</h1>
<p>Vincent van Gogh (Dutch, 1853–1890). 1889. Oil on canvas. Purchase, The Annenberg Foundation Gift, 1993. Accession Number: 1993.132.</p>
<p>Vincent van Gogh painted Wheat Field with Cypresses in 1889.</p><p>Van Gogh painted this wheat field with cypresses in late June 1889 while at the asylum in Saint-Rémy.</p></main>
<footer>Copyright</footer></body></html>`;

const entity = {
  id: 'Q18689458', type: 'item', labels: { en: { language: 'en', value: 'Wheat Field with Cypresses' } },
  claims: {
    P571: [{ mainsnak: { snaktype: 'value', datavalue: { type: 'time', value: { time: '+1889-06-00T00:00:00Z' } } } }],
    P217: [{ mainsnak: { snaktype: 'value', datavalue: { type: 'string', value: '1993.132' } } }],
    P195: [{ mainsnak: { snaktype: 'value', datavalue: { type: 'wikibase-entityid', value: { id: 'Q160236' } } } }],
    P2048: [{ mainsnak: { snaktype: 'value', datavalue: { type: 'quantity', value: { amount: '+73', unit: 'http://www.wikidata.org/entity/Q174728' } } } }],
    P1476: [{ mainsnak: { snaktype: 'value', datavalue: { type: 'monolingualtext', value: { text: 'Wheat Field with Cypresses', language: 'en' } } } }],
  },
};
const museumEntity = { id: 'Q160236', type: 'item', labels: { en: { language: 'en', value: 'Metropolitan Museum of Art' } } };

const searchResponse = {
  results: [
    { url: SEARCH_HIT, title: 'Wheat Field with Cypresses', content: 'Short snippet.', raw_content: 'The painting was acquired in 1993. The lively brushwork conveys wind through the wheat field.', score: 0.9 },
    { url: 'https://www.metmuseum.org/art/collection/search/99999', title: 'Wheat Field with Cypresses', content: 'Another version was made in a different year.', score: 0.99 },
    { url: 'https://www.metmuseum.org/art/collection/search/caf%E9', title: 'Latin-1 escape', content: 'Malformed percent escape must not abort the action.', score: 0.9 },
    { url: 'https://www.pinterest.com/pin/1', title: 'Wheat field', content: 'Pinned image', score: 0.95 },
    { url: 'https://randomblog.example/vangogh', title: 'Blog', content: 'My thoughts', score: 0.8 },
    { url: 'https://store.metmuseum.org/van-gogh-wheat-field-tee', title: 'Van Gogh tee', content: 'Reproduced on this comfy tee.', score: 0.9 },
    { url: 'https://www.metmuseum.org/shop/prints/489070', title: 'Custom print', content: 'Order a print.', score: 0.9 },
  ],
  usage: { credits: 1 },
};

const facts = [
  { id: 'f1', text: 'Vincent van Gogh painted Wheat Field with Cypresses in 1889.', sourceUrl: PAGE, sourceLabel: 'x', sourceScore: 0.1 },
  { id: 'f2', text: 'The painting was acquired in 1993.', sourceUrl: SEARCH_HIT, sourceLabel: 'x', sourceScore: 0.1 },
  { id: 'f3', text: 'Inventory number: 1993.132', sourceUrl: WIKIDATA_PAGE, sourceLabel: 'x', sourceScore: 0.1 },
  { id: 'f4', text: 'It hung in a Paris salon.', sourceUrl: 'https://invented.example/salon', sourceLabel: 'x', sourceScore: 1 },
  { id: 'f5', text: 'The painting was acquired in 1993.', sourceUrl: PAGE, sourceLabel: 'x', sourceScore: 1 },
];
const prose = [
  { sentence: 'Vincent van Gogh painted this wheat field in 1889.', fact_ids: ['f1'] },
  { sentence: 'The museum acquired it in 1993 under inventory number 1993.132.', fact_ids: ['f2', 'f3'] },
  { sentence: 'It once hung in a Paris salon.', fact_ids: ['f9'] },
  { sentence: 'Too short here.', fact_ids: ['f1'] },
];

type Route = (url: URL, init?: RequestInit) => Response | undefined;
const fetchMock = vi.fn<typeof fetch>();
let routes: Route[] = [];

beforeEach(() => {
  routes = [];
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    for (const route of routes) {
      const response = route(url, init);
      if (response) return response;
    }
    throw new Error(`Unexpected fetch ${url.href}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('NEBIUS_API_KEY', 'nebius-test');
  vi.stubEnv('TAVILY_API_KEY', 'tvly-test');
  vi.stubEnv('FACT_SHEET_MODEL', FACT_SHEET_MODEL);
  vi.stubEnv('DOCENT_MODEL', DOCENT_MODEL);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function page(href: string, html: string, init?: ResponseInit) {
  routes.push((url) => (url.href === href ? new Response(html, init) : undefined));
}
function wikidata(status = 200) {
  routes.push((url) => {
    if (`${url.origin}${url.pathname}` !== WIKIDATA) return undefined;
    if (status !== 200) return new Response('down', { status });
    const ids = (url.searchParams.get('ids') ?? '').split('|');
    const entities: Record<string, unknown> = {};
    for (const id of ids) entities[id] = id === 'Q18689458' ? entity : id === 'Q160236' ? museumEntity : { id, missing: '' };
    return jsonResponse({ entities });
  });
}
function tavily(response: unknown = searchResponse, status = 200) {
  routes.push((url) => (url.href === TAVILY ? (status === 200 ? jsonResponse(response) : new Response('down', { status })) : undefined));
}
function models(sheet: unknown = facts, sentences: unknown = prose) {
  routes.push((url, init) => {
    if (url.href !== TOKEN_FACTORY) return undefined;
    const body = JSON.parse(String(init?.body));
    return completion(body.model === FACT_SHEET_MODEL ? sheet : sentences);
  });
}
function everything() {
  page(PAGE, ownerPage);
  wikidata();
  tavily();
  models();
}
const calls = (prefix: string) => fetchMock.mock.calls.filter(([url]) => String(url).startsWith(prefix));
const bodies = (prefix: string) => calls(prefix).map(([, init]) => JSON.parse(String(init?.body)));

async function fixture(options: { pageUrl?: string | null; wikidataId?: string | null; optOut?: boolean } = {}) {
  const t = harness();
  const { deviceId } = await seedDevice(t);
  const museumId = await t.run((ctx) => seedMuseum(ctx, {
    name: 'The Metropolitan Museum of Art', website: 'https://www.metmuseum.org/', optOut: options.optOut ?? false,
  }));
  const work = await t.run((ctx) => seedArtworkWithObject(ctx, {
    artwork: { title: 'Wheat Field with Cypresses', artist: 'Vincent van Gogh', date: '1889', wikidataId: options.wikidataId === null ? undefined : options.wikidataId ?? 'Q18689458' },
    object: { ownerId: museumId, pageUrl: options.pageUrl === null ? undefined : options.pageUrl ?? PAGE },
  }));
  const artwork = () => t.run((ctx) => ctx.db.get(work.artworkId));
  const spend = async () => (await t.run((ctx) => ctx.db.query('dailySpend').collect()))[0];
  const ensure = () => t.action(internal.docent.ensure, { artworkId: work.artworkId, deviceId });
  return { t, deviceId, museumId, work, artwork, spend, ensure };
}

describe('docent.ensure', () => {
  it('generates a sourced fact sheet and validated sentences on a cache miss and settles spend', async () => {
    const { artwork, spend, ensure } = await fixture();
    everything();
    await ensure();
    const stored = await artwork();
    expect(stored?.factSheet).toEqual([
      { id: 'f1', text: 'Vincent van Gogh painted Wheat Field with Cypresses in 1889.', sourceUrl: PAGE, sourceLabel: 'The Metropolitan Museum of Art', sourceScore: 1 },
      { id: 'f2', text: 'The painting was acquired in 1993.', sourceUrl: SEARCH_HIT, sourceLabel: 'metmuseum.org', sourceScore: 1 },
      { id: 'f3', text: 'Inventory number: 1993.132', sourceUrl: WIKIDATA_PAGE, sourceLabel: 'Wikidata', sourceScore: 0.8 },
    ]);
    expect(stored?.docent).toEqual({ en: [
      { sentence: 'Vincent van Gogh painted this wheat field in 1889.', factIds: ['f1'] },
      { sentence: 'The museum acquired it in 1993 under inventory number 1993.132.', factIds: ['f2', 'f3'] },
    ] });
    expect(stored?.factSheetUpdatedAt).toEqual(expect.any(Number));
    expect(stored?.docentUpdatedAt).toEqual(expect.any(Number));
    expect(stored?.enrichClaimedAt).toBeUndefined();
    expect(await spend()).toMatchObject({ tokenFactoryCalls: 2, tavilyCredits: 1 });

    const [search] = bodies(TAVILY);
    expect(search).toMatchObject({
      query: '"Wheat Field with Cypresses" Vincent van Gogh The Metropolitan Museum of Art', include_raw_content: 'markdown', topic: 'general', search_depth: 'basic', max_results: 8,
      include_domains_mode: 'filter',
    });
    expect(search.include_domains).toContain('metmuseum.org');
    expect(search.include_domains).not.toContain('pinterest.com');
    const [sheet, docent] = bodies(TOKEN_FACTORY);
    expect(sheet).toMatchObject({ model: FACT_SHEET_MODEL, temperature: 0, max_tokens: 6000, chat_template_kwargs: { enable_thinking: false } });
    expect(JSON.parse(sheet.messages[1].content).input.target).toEqual({
      title: 'Wheat Field with Cypresses', artist: 'Vincent van Gogh', date: '1889', wikidataId: 'Q18689458',
    });
    const input = JSON.parse(sheet.messages[1].content).input.sources as { url: string; label: string; score: number; text: string }[];
    expect(input.map(({ url, label, score }) => ({ url, label, score }))).toEqual([
      { url: PAGE, label: 'The Metropolitan Museum of Art', score: 1 },
      { url: SEARCH_HIT, label: 'metmuseum.org', score: 1 },
      { url: WIKIDATA_PAGE, label: 'Wikidata', score: 0.8 },
    ]);
    expect(input[0].text).toContain('Saint-Rémy');
    expect(input[1].text).toContain('lively brushwork');
    expect(calls(TAVILY)).toHaveLength(1);
    expect(input[0].text).not.toContain('Visit Exhibitions Shop');
    expect(input[2].text).toContain('Inception: 1889');
    expect(input[2].text).toContain('Collection: Metropolitan Museum of Art');
    expect(input[2].text).toContain('Height: 73 cm');
    expect(input[2].text).toContain('Inventory number: 1993.132');
    expect(docent).toMatchObject({ model: DOCENT_MODEL, temperature: 0, max_tokens: 1024 });
    expect(JSON.parse(docent.messages[1].content).input).toEqual(stored?.factSheet);
  });

  it('makes no calls when sentences are cached, under review, or claimed by a concurrent run', async () => {
    const { t, work, artwork, ensure, spend } = await fixture();
    everything();
    await t.run((ctx) => ctx.db.patch(work.artworkId, { docent: { en: [] }, docentUpdatedAt: 1 }));
    await ensure();
    await t.run((ctx) => ctx.db.patch(work.artworkId, { docent: undefined, docentUpdatedAt: undefined, factSheetNeedsReview: true }));
    await ensure();
    await t.run((ctx) => ctx.db.patch(work.artworkId, { factSheetNeedsReview: undefined, enrichClaimedAt: Date.now() - 5 * 60 * 1000 }));
    await ensure();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await spend()).toBeUndefined();
    await t.run((ctx) => ctx.db.patch(work.artworkId, { enrichClaimedAt: Date.now() - 11 * 60 * 1000 }));
    await ensure();
    expect((await artwork())?.docent?.en).toHaveLength(2);
  });

  it('skips generation without spending when the models are unconfigured or the daily cap is reached', async () => {
    const { artwork, ensure, spend } = await fixture();
    everything();
    vi.stubEnv('DOCENT_MODEL', '');
    await ensure();
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await artwork())?.enrichClaimedAt).toBeUndefined();
    vi.stubEnv('DOCENT_MODEL', DOCENT_MODEL);
    vi.stubEnv('DAILY_TOKEN_FACTORY_CALL_CAP', '0');
    await ensure();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await spend()).toBeUndefined();
    expect((await artwork())?.enrichClaimedAt).toBeUndefined();
  });

  it('fetches the owner page only on the venue host and never for an opted-out venue', async () => {
    const offHost = await fixture({ pageUrl: 'https://mirror.example/436535' });
    everything();
    await offHost.ensure();
    expect(calls('https://mirror.example')).toEqual([]);
    expect((await offHost.artwork())?.factSheet?.map((fact) => fact.sourceUrl)).toEqual([WIKIDATA_PAGE]);

    fetchMock.mockClear();
    const optedOut = await fixture({ optOut: true });
    await optedOut.ensure();
    expect(calls(PAGE)).toEqual([]);
    expect((await optedOut.artwork())?.factSheet?.map((fact) => fact.sourceUrl)).toEqual([WIKIDATA_PAGE]);
  });

  it('caches an empty sheet when no admissible source exists, but retries later after fetch failures', async () => {
    const bare = await fixture({ pageUrl: null, wikidataId: null });
    tavily({ results: [{ url: 'https://randomblog.example/x', title: 'x', content: 'y', score: 0.9 }], usage: { credits: 1 } });
    models();
    await bare.ensure();
    expect(await bare.artwork()).toMatchObject({ factSheet: [], docent: { en: [] } });
    expect(await bare.artwork()).not.toHaveProperty('enrichClaimedAt');
    expect(calls(TOKEN_FACTORY)).toEqual([]);
    expect(await bare.spend()).toMatchObject({ tokenFactoryCalls: 0, tavilyCredits: 1 });

    fetchMock.mockClear();
    routes = [];
    const failing = await fixture();
    page(PAGE, 'down', { status: 503 });
    wikidata(500);
    tavily(undefined, 500);
    models();
    await failing.ensure();
    const stored = await failing.artwork();
    expect(stored?.factSheet).toBeUndefined();
    expect(stored?.docent).toBeUndefined();
    expect(stored?.enrichClaimedAt).toBeUndefined();
    expect(calls(TOKEN_FACTORY)).toEqual([]);
  });

  it('releases the claim, settles spend, and writes nothing when the model fails', async () => {
    const { artwork, ensure, spend } = await fixture();
    page(PAGE, ownerPage);
    wikidata();
    tavily();
    routes.push((url) => (url.href === TOKEN_FACTORY ? new Response('busy', { status: 503, headers: { 'retry-after': '0' } }) : undefined));
    await expect(ensure()).rejects.toMatchObject({ data: { code: 'model_error', reason: 'http_503', calls: 2 } });
    const stored = await artwork();
    expect(stored?.factSheet).toBeUndefined();
    expect(stored?.enrichClaimedAt).toBeUndefined();
    expect(await spend()).toMatchObject({ tokenFactoryCalls: 2, tavilyCredits: 1 });
  });

  it('rewrites only the sentences when a current fact sheet exists', async () => {
    const { t, work, artwork, ensure, spend } = await fixture();
    everything();
    const factSheet = [{ id: 'f1', text: 'Painted in 1889.', sourceUrl: PAGE, sourceLabel: 'The Met', sourceScore: 1 }];
    await t.run((ctx) => ctx.db.patch(work.artworkId, { factSheet, factSheetUpdatedAt: 5 }));
    await ensure();
    expect(calls(TAVILY)).toEqual([]);
    expect(calls(PAGE)).toEqual([]);
    expect(bodies(TOKEN_FACTORY).map((body) => body.model)).toEqual([DOCENT_MODEL]);
    const stored = await artwork();
    expect(stored).toMatchObject({ factSheet, factSheetUpdatedAt: 5 });
    expect(stored?.docent?.en).toEqual([{ sentence: 'Vincent van Gogh painted this wheat field in 1889.', factIds: ['f1'] }]);
    expect(await spend()).toMatchObject({ tokenFactoryCalls: 1 });
  });

  it('limits a device to sixty generations per hour', async () => {
    const { t, deviceId } = await fixture({ pageUrl: null, wikidataId: null });
    vi.stubEnv('DAILY_TAVILY_CREDIT_CAP', '1000');
    tavily();
    models();
    const artworkIds: Id<'artworks'>[] = [];
    await t.run(async (ctx) => {
      for (let i = 0; i < 61; i++) artworkIds.push((await seedArtworkWithObject(ctx)).artworkId);
    });
    for (const artworkId of artworkIds) await t.action(internal.docent.ensure, { artworkId, deviceId });
    const last = await t.run((ctx) => ctx.db.get(artworkIds[60]));
    expect(last?.factSheet).toBeUndefined();
    expect(last?.enrichClaimedAt).toBeUndefined();
    expect(calls(TAVILY)).toHaveLength(60);
    expect((await t.run((ctx) => ctx.db.get(artworkIds[59])))?.docent?.en).toHaveLength(1);
  });
});

describe('docent write mutations', () => {
  async function seeded(t: Harness) {
    return t.run((ctx) => seedArtworkWithObject(ctx));
  }

  it('writeEnrichment stores the sheet and sentences for the owning claim', async () => {
    const t = harness();
    const { artworkId } = await seeded(t);
    const generation = (await t.mutation(internal.docent.claim, { artworkId }))!;
    const factSheet = [{ id: 'f1', text: 'A fact.', sourceUrl: PAGE, sourceLabel: 'The Met', sourceScore: 1 }];
    const docentEn = [{ sentence: 'A sentence with four words.', factIds: ['f1'] }];
    await t.mutation(internal.docent.writeEnrichment, { artworkId, generation, factSheet, docentEn });
    const written = await t.run((ctx) => ctx.db.get(artworkId));
    expect(written).toMatchObject({
      factSheet, docent: { en: docentEn }, factSheetUpdatedAt: expect.any(Number), docentUpdatedAt: expect.any(Number),
    });
    expect(written).not.toHaveProperty('enrichClaimedAt');
    expect(written).not.toHaveProperty('factSheetNeedsReview');
    await t.mutation(internal.docent.invalidateDocent, { artworkId });
    const invalidated = await t.run((ctx) => ctx.db.get(artworkId));
    expect(invalidated).toMatchObject({ factSheet });
    expect(invalidated).not.toHaveProperty('docent');
    expect(invalidated).not.toHaveProperty('docentUpdatedAt');
  });
});

it('rejects late writes and releases after a claim is reclaimed or invalidated', async () => {
  const t = harness();
  const { artworkId } = await t.run((ctx) => seedArtworkWithObject(ctx));
  const generation = (await t.mutation(internal.docent.claim, { artworkId }))!;
  await t.run((ctx) => ctx.db.patch(artworkId, { enrichClaimedAt: Date.now() - 11 * 60 * 1000 }));
  const next = (await t.mutation(internal.docent.claim, { artworkId }))!;
  const result = { artworkId, factSheet: [], docentEn: [] };
  expect(await t.mutation(internal.docent.writeEnrichment, { ...result, generation })).toBe(false);
  await t.mutation(internal.enrich.releaseClaim, { artworkId, generation });
  expect(await t.run((ctx) => ctx.db.get(artworkId))).toMatchObject({ enrichGeneration: next, enrichClaimedAt: expect.any(Number) });
  await t.mutation(internal.docent.invalidateDocent, { artworkId });
  expect(await t.mutation(internal.docent.writeEnrichment, { ...result, generation: next })).toBe(false);
  expect((await t.run((ctx) => ctx.db.get(artworkId)))?.docent).toBeUndefined();
});

it('shares a single research search between independent docent and audio scripts', async () => {
  const { t, work, ensure, artwork } = await fixture();
  everything(); await ensure();
  const researched = await artwork();
  vi.stubEnv('OPENAI_API_KEY', 'speech-test');
  routes.unshift((url) => url.href === TOKEN_FACTORY ? completion(guideBodyFixture.map(({ sentence, factIds }) => ({ sentence, fact_ids: factIds, support: researched!.factSheet!.find((fact) => fact.id === factIds[0])!.text.slice(0, 30) }))) : undefined);
  routes.push((url) => url.href.includes('api.openai.com') ? new Response(new Uint8Array([73, 68, 51]), { headers: { 'Content-Type': 'audio/mpeg' } }) : undefined);
  const { as } = await seedDevice(t);
  const spoken = await as.action(api.narration.render, { artworkId: work.artworkId });
  expect(spoken.sentences).toEqual([{ sentence: guideOpening(researched!), factIds: [] }, ...guideBodyFixture]);
  expect((await artwork())?.docent).toEqual(researched?.docent);
  expect(calls(TAVILY)).toHaveLength(1);
  expect(JSON.parse(bodies(TOKEN_FACTORY)[2].messages[1].content).research).toEqual(guideResearch(researched!.factSheet!));
});

it('refreshes the shared research when explicitly invalidated', async () => {
  const { t, work, ensure, artwork } = await fixture();
  everything(); await ensure();
  await t.mutation(internal.docent.invalidateDocent, { artworkId: work.artworkId, includeResearch: true });
  expect((await artwork())?.factSheet).toBeUndefined();
  expect((await artwork())?.docent).toBeUndefined();
  await ensure();
  expect(calls(TAVILY)).toHaveLength(2);
  expect((await artwork())?.factSheet?.length).toBeGreaterThan(0);
});

it('includes museum essays linked to the exact artwork while excluding another version', async () => {
  const { ensure } = await fixture({ pageUrl: PAGE.replace('https:', 'http:') });
  page(PAGE, ownerPage); wikidata(); models();
  tavily({ results: [
    { url: 'https://www.metmuseum.org/exhibitions/listings/2015/van-gogh', raw_content: 'Historical context for [this painting](/exhibitions/view?oid=436535&exhibitionId=one).' },
    { url: 'https://www.metmuseum.org/perspectives/another-version', raw_content: 'Another version: [painting](/exhibitions/view?oid=99999).' },
    { url: 'https://www.metmuseum.org/art/collection/search/99999', raw_content: 'Another painting. Related work: [target](/art/collection/search/436535).' },
  ], usage: { credits: 1 } });
  await ensure();
  const sources = JSON.parse(bodies(TOKEN_FACTORY)[0].messages[1].content).input.sources;
  expect(sources.map((source: { url: string }) => source.url)).toEqual([PAGE, 'https://www.metmuseum.org/exhibitions/listings/2015/van-gogh', WIKIDATA_PAGE]);
  expect(calls(PAGE)).toHaveLength(1);
  expect(calls(TAVILY)).toHaveLength(1);
});

it('sends markdown search pages as plain prose, so a fact copied from an essay survives the verbatim check', async () => {
  const { ensure, artwork } = await fixture();
  const essay = 'https://www.metmuseum.org/perspectives/van-gogh-cypresses';
  const quoted = { id: 'f1', text: 'He described the cypresses in Wheat Field with Cypresses as a splash of black.', sourceUrl: essay, sourceLabel: 'x', sourceScore: 1 };
  page(PAGE, ownerPage); wikidata(); models([quoted]);
  tavily({ results: [{
    url: essay, title: 'Cypresses', content: 'Snippet',
    raw_content: '## Letters\n\n![Detail](https://images.example/detail_(crop).jpg)\n\nHe described the cypresses in *Wheat Field with Cypresses* as a **splash of black**. See [the painting](/art/collection/search/436535).',
  }], usage: { credits: 1 } });
  await ensure();
  const sources: { url: string; text: string }[] = JSON.parse(bodies(TOKEN_FACTORY)[0].messages[1].content).input.sources;
  expect(sources.find((source) => source.url === essay)?.text)
    .toBe('Cypresses\nLetters\n\nHe described the cypresses in Wheat Field with Cypresses as a splash of black. See the painting.');
  expect((await artwork())?.factSheet?.map((fact) => fact.text)).toEqual([quoted.text]);
});

it.each([
  ['a shorter', 'Wheat Field with Cypresses, a painting.', 'Saint-Rémy'],
  ['a fuller', `Vincent van Gogh (Dutch, 1853–1890). ${'The lively brushwork conveys wind through the wheat field. '.repeat(20)}`, 'lively brushwork'],
])('sends the owner page once when search returns %s copy of it, and keeps facts quoted from the text sent', async (_, rawContent, kept) => {
  const { ensure, artwork } = await fixture();
  const quoted = { id: 'f1', text: 'Vincent van Gogh (Dutch, 1853–1890).', sourceUrl: PAGE, sourceLabel: 'x', sourceScore: 1 };
  page(PAGE, ownerPage); wikidata(); models([quoted]);
  tavily({ results: [{ url: PAGE, title: 'Wheat Field with Cypresses', content: 'Snippet', raw_content: rawContent }], usage: { credits: 1 } });
  await ensure();
  const sources: { url: string; label: string; score: number; text: string }[] = JSON.parse(bodies(TOKEN_FACTORY)[0].messages[1].content).input.sources;
  const owner = sources.filter((source) => source.url === PAGE);
  expect(owner).toEqual([expect.objectContaining({ label: 'The Metropolitan Museum of Art', score: 1 })]);
  expect(owner[0].text).toContain(kept);
  expect((await artwork())?.factSheet?.map((fact) => fact.text)).toEqual([quoted.text]);
});
