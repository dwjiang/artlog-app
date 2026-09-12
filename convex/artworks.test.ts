import { expect, it } from 'vitest';

import { api } from './_generated/api';
import { seedArtworkWithObject, seedDevice } from './lib/testFactories';
import { harness, signIn } from './test.helpers';

const docent = [{ sentence: 'Monet painted this pond at Giverny in 1916.', factIds: ['f1', 'f2'] }];
const factSheet = [
  { id: 'f1', text: 'Painted in 1916.', sourceUrl: 'https://www.wikidata.org/wiki/Q1', sourceLabel: 'Wikidata', sourceScore: 0.8 },
  { id: 'f2', text: 'The pond is at Giverny.', sourceUrl: 'https://museum.example/lilies', sourceLabel: 'Test Museum', sourceScore: 1 },
];

it('returns docent sentences, source chips and the public-domain thumbnail to a registered device', async () => {
  const t = harness();
  const { as } = await seedDevice(t);
  const { artworkId } = await t.run((ctx) => seedArtworkWithObject(ctx, { artwork: { docent: { en: docent }, factSheet } }));
  expect(await as.query(api.artworks.enrichment, { artworkId })).toEqual({
    docent,
    factSheet: [
      { id: 'f1', sourceUrl: 'https://www.wikidata.org/wiki/Q1', sourceLabel: 'Wikidata' },
      { id: 'f2', sourceUrl: 'https://museum.example/lilies', sourceLabel: 'Test Museum' },
    ],
    rightsStatus: 'public_domain',
    thumbnailUrl: 'https://museum.example/work.jpg',
  });
});

it('omits the thumbnail for in-copyright works and reverted objects, and returns null for a missing artwork', async () => {
  const t = harness();
  const { as } = await seedDevice(t);
  const inCopyright = await t.run((ctx) => seedArtworkWithObject(ctx, { artwork: { rightsStatus: 'in_copyright' } }));
  expect(await as.query(api.artworks.enrichment, { artworkId: inCopyright.artworkId })).toEqual({ rightsStatus: 'in_copyright' });
  const reverted = await t.run((ctx) => seedArtworkWithObject(ctx, { object: { reverted: true } }));
  expect(await as.query(api.artworks.enrichment, { artworkId: reverted.artworkId })).toEqual({ rightsStatus: 'public_domain' });
  const gone = await t.run((ctx) => seedArtworkWithObject(ctx));
  await t.run((ctx) => ctx.db.delete(gone.artworkId));
  expect(await as.query(api.artworks.enrichment, { artworkId: gone.artworkId })).toBeNull();
});

it('rejects anonymous and unregistered callers', async () => {
  const t = harness();
  const { artworkId } = await t.run((ctx) => seedArtworkWithObject(ctx));
  await expect(t.query(api.artworks.enrichment, { artworkId })).rejects.toMatchObject({ data: { code: 'unauthenticated' } });
  const user = await signIn(t);
  await expect(user.as.query(api.artworks.enrichment, { artworkId })).rejects.toMatchObject({ data: { code: 'device_not_registered' } });
});
