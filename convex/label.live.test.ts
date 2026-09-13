// Manual live label check against the dev deployment; skipped unless LABEL_LIVE=1.
// Reads a label photo, then verifies the fields with real Wikidata and Tavily calls (one credit).
//   set -a; source .env.local; set +a
//   LABEL_LIVE=1 LABEL_LIVE_VENUE_ID=<museums id> LABEL_LIVE_PHOTO=/path/to/label.jpg \
//     npx vitest run convex/label.live.test.ts
import { readFileSync } from 'node:fs';
import { stdout } from 'node:process';
import { ConvexHttpClient } from 'convex/browser';
import { expect, it } from 'vitest';

import model from '../shared/model-version.json';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { encodeOrbFeatures } from '../shared/orb';
import { makeSyntheticPair } from '../shared/orb/test-fixtures';
import { testVector } from './lib/testFactories';

it.skipIf(process.env.LABEL_LIVE !== '1')('reads and verifies a real label photo on the dev deployment', async () => {
  const url = process.env.CONVEX_URL ?? process.env.EXPO_PUBLIC_CONVEX_URL;
  const venueId = process.env.LABEL_LIVE_VENUE_ID as Id<'museums'> | undefined;
  const photo = process.env.LABEL_LIVE_PHOTO;
  if (!url || !venueId || !photo) throw new Error('CONVEX_URL, LABEL_LIVE_VENUE_ID and LABEL_LIVE_PHOTO are required');
  const client = new ConvexHttpClient(url);
  const secret = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
  const signedIn = await client.action(api.auth.signIn, { provider: 'anonymous', params: { secret } });
  const token = signedIn.tokens?.token;
  if (!token) throw new Error('Anonymous sign-in returned no token');
  client.setAuth(token);
  await client.mutation(api.devices.registerDevice, { platform: 'simulator' });
  const pair = makeSyntheticPair({ count: 120 });
  const scan = await client.action(api.identify.identify, {
    localId: crypto.randomUUID(), vector: testVector(), ...encodeOrbFeatures(pair.query),
    modelVersion: model.modelVersion, venueId, capturedAt: Date.now(),
  });
  stdout.write(`scan ${scan.scanId} status=${scan.status} outcome=${scan.outcome}\n`);

  const imageBase64 = readFileSync(photo).toString('base64');
  let started = Date.now();
  const read = await client.action(api.label.readLabel, { scanId: scan.scanId, imageBase64 });
  stdout.write(`readLabel ${Date.now() - started} ms moderation=${read.moderation}\n${JSON.stringify(read.fields, null, 2)}\n`);
  expect(read.stage).toBe('read');

  const fields = Object.fromEntries(Object.entries(read.fields).map(([name, field]) => [name, field.value]));
  started = Date.now();
  const verified = await client.action(api.label.verifyLabel, { scanId: scan.scanId, fields });
  stdout.write(`verifyLabel ${Date.now() - started} ms\n${JSON.stringify(verified, null, 2)}\n`);
  expect(verified.stage).toBe('verified');
  const status = await client.query(api.scans.get, { scanId: scan.scanId });
  expect(status?.scanId).toBe(scan.scanId);
}, 120_000);
