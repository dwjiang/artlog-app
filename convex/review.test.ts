import { describe, expect, it } from 'vitest';

import { api, internal } from './_generated/api';
import { seedArtworkWithObject, seedDevice } from './lib/testFactories';
import { harness } from './test.helpers';

const factSheet = [{ id: 'f1', text: 'Painted in 1916.', sourceUrl: 'https://museum.example/work', sourceLabel: 'Museum', sourceScore: 1 }];

async function fixture() {
  const t = harness({ transactionLimits: true });
  const user = await seedDevice(t);
  const { artworkId } = await t.run((ctx) => seedArtworkWithObject(ctx, { artwork: { factSheet, factSheetUpdatedAt: 1 } }));
  await user.as.mutation(api.corrections.correctFact, { artworkId, factId: 'f1', message: 'The year is wrong.' });
  const [correction] = await t.query(internal.review.listCorrections, {});
  return { t, user, artworkId, correction };
}

describe('review.replaceFactSheet', () => {
  it('resolves only addressed reports and keeps the hold until every report is reviewed', async () => {
    const { t, user, artworkId, correction } = await fixture();
    await user.as.mutation(api.corrections.correctFact, { artworkId, factId: 'f1', message: 'The source is also wrong.' });
    await t.mutation(internal.review.replaceFactSheet, { artworkId, factSheet, correctionIds: [correction._id] });
    const open = await t.query(internal.review.listCorrections, {});
    expect(open).toHaveLength(1);
    expect(open[0].message).toBe('The source is also wrong.');
    expect(await t.query(internal.review.listCorrections, { status: 'resolved' })).toMatchObject([{ _id: correction._id }]);
    expect((await t.run((ctx) => ctx.db.get(artworkId)))?.factSheetNeedsReview).toBe(true);
    await t.mutation(internal.review.replaceFactSheet, { artworkId, factSheet, correctionIds: [open[0]._id] });
    expect(await t.query(internal.review.listCorrections, {})).toEqual([]);
    expect((await t.run((ctx) => ctx.db.get(artworkId)))?.factSheetNeedsReview).toBeUndefined();
  });

  it('rejects a correction from another artwork without changing either report or sheet', async () => {
    const { t, artworkId, correction } = await fixture();
    const other = await t.run((ctx) => seedArtworkWithObject(ctx, { artwork: { factSheet } }));
    await expect(t.mutation(internal.review.replaceFactSheet, {
      artworkId: other.artworkId, factSheet: [], correctionIds: [correction._id],
    })).rejects.toMatchObject({ data: { code: 'invalid_correction' } });
    expect((await t.run((ctx) => ctx.db.get(other.artworkId)))?.factSheet).toEqual(factSheet);
    expect((await t.run((ctx) => ctx.db.get(artworkId)))?.factSheetNeedsReview).toBe(true);
    expect(await t.query(internal.review.listCorrections, {})).toHaveLength(1);
  });

  it('rejects an oversized review before changing reports or lifting the hold', async () => {
    const { t, artworkId, correction } = await fixture();
    await expect(t.mutation(internal.review.replaceFactSheet, {
      artworkId, factSheet: [], correctionIds: Array(101).fill(correction._id),
    })).rejects.toMatchObject({ data: { code: 'too_many_corrections' } });
    expect((await t.run((ctx) => ctx.db.get(artworkId)))?.factSheet).toEqual(factSheet);
    expect(await t.query(internal.review.listCorrections, {})).toHaveLength(1);
  });

  it('allows a sheet edit without resolving unaddressed reports', async () => {
    const { t, artworkId } = await fixture();
    await t.mutation(internal.review.replaceFactSheet, { artworkId, factSheet, correctionIds: [] });
    expect((await t.run((ctx) => ctx.db.get(artworkId)))?.factSheetNeedsReview).toBe(true);
    expect(await t.query(internal.review.listCorrections, {})).toHaveLength(1);
  });

  it('drains a backlog through bounded reviews without hiding the remaining reports', async () => {
    const { t, user, artworkId } = await fixture();
    await t.run(async (ctx) => {
      for (let i = 0; i < 100; i++) await ctx.db.insert('factCorrections', {
        artworkId, factId: 'f1', message: `Report ${i}`, deviceId: user.deviceId, createdAt: Date.now(), status: 'open',
      });
    });
    const first = await t.query(internal.review.listCorrections, {});
    expect(first).toHaveLength(100);
    await t.mutation(internal.review.replaceFactSheet, { artworkId, factSheet, correctionIds: first.map((row) => row._id) });
    const remaining = await t.query(internal.review.listCorrections, {});
    expect(remaining).toHaveLength(1);
    await t.mutation(internal.review.replaceFactSheet, { artworkId, factSheet, correctionIds: [remaining[0]._id] });
    expect(await t.query(internal.review.listCorrections, {})).toEqual([]);
    expect((await t.run((ctx) => ctx.db.get(artworkId)))?.factSheetNeedsReview).toBeUndefined();
  });
});
