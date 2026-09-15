// Manual live museum-search check against the dev deployment; skipped unless MUSEUM_SEARCH_LIVE=1.
// Describes a public-domain Met crop, runs one Tavily search on the venue's hosts (one credit) and
// prints the candidates. The credit count comes from `npx convex run spend:status` before and after.
//   set -a; source .env.local; set +a
//   MUSEUM_SEARCH_LIVE=1 MUSEUM_SEARCH_LIVE_VENUE_ID=<museums id> npx vitest run convex/museumSearch.live.test.ts
// MUSEUM_SEARCH_LIVE_PHOTO overrides the crop (default: scripts/data/fixtures/test-painting.jpg, Met 436535, CC0).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { stdout } from 'node:process';
import { ConvexHttpClient } from 'convex/browser';
import { expect, it } from 'vitest';

import model from '../shared/model/model-version.json';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { encodeOrbFeatures } from '../shared/orb';
import { makeSyntheticPair } from '../shared/orb/test-fixtures';
import { testVector } from './lib/testFactories';

function tavilySpent(): number {
  // Sourcing an unquoted CONVEX_DEPLOY_KEY line exports a stray empty `eyJ…` variable that the CLI refuses.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => !(key.startsWith('ey') && value === ''))) as NodeJS.ProcessEnv;
  const output = execFileSync('npx', ['convex', 'run', 'spend:status', JSON.stringify({ kind: 'tavily' })], {
    encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'inherit'],
  });
  return (JSON.parse(output) as { spent: number }).spent;
}

it.skipIf(process.env.MUSEUM_SEARCH_LIVE !== '1')('describes a crop and searches the venue site on the dev deployment', async () => {
  const url = process.env.CONVEX_URL ?? process.env.EXPO_PUBLIC_CONVEX_URL;
  const venueId = process.env.MUSEUM_SEARCH_LIVE_VENUE_ID as Id<'museums'> | undefined;
  const photo = process.env.MUSEUM_SEARCH_LIVE_PHOTO ?? 'scripts/data/fixtures/test-painting.jpg';
  if (!url || !venueId) throw new Error('CONVEX_URL and MUSEUM_SEARCH_LIVE_VENUE_ID are required');
  const client = new ConvexHttpClient(url);
  const secret = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
  const signedIn = await client.action(api.auth.signIn, { provider: 'anonymous', params: { secret } });
  const token = signedIn.tokens?.token;
  if (!token) throw new Error('Anonymous sign-in returned no token');
  client.setAuth(token);
  await client.mutation(api.devices.registerDevice, { platform: 'simulator' });
  const pair = makeSyntheticPair({ count: 120 });
  const scan = await client.action(api.identify.identify, { ...{
    localId: crypto.randomUUID(), vector: testVector(), ...encodeOrbFeatures(pair.query),
    modelVersion: model.modelVersion, venueId, capturedAt: Date.now(),
  }, scope: (await client.query(api.accounts.me, {})).scope });
  stdout.write(`scan ${scan.scanId} status=${scan.status} outcome=${scan.outcome}\n`);
  expect(scan.outcome).not.toBe('confident');

  const imageBase64 = readFileSync(photo).toString('base64');
  const before = tavilySpent();
  const started = Date.now();
  const result = await client.action(api.museumSearch.searchMuseumSite, { scanId: scan.scanId, imageBase64 });
  stdout.write(`searchMuseumSite ${Date.now() - started} ms\n${JSON.stringify(result, null, 2)}\n`);
  const credits = tavilySpent() - before;
  stdout.write(`tavily credits spent: ${credits}\n`);
  expect(['candidates', 'none']).toContain(result.stage);
  expect(credits).toBeLessThanOrEqual(1);
  const status = await client.query(api.scans.get, { scanId: scan.scanId });
  expect(status?.museumSearch).toEqual(result);
}, 120_000);
