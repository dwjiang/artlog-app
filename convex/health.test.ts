/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';

import model from '../shared/model-version.json';
import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.*s');

describe('health.ping', () => {
  it('reports the backend time and the shared model version', async () => {
    const t = convexTest(schema, modules);
    const before = Date.now();

    const health = await t.query(api.health.ping, {});

    expect(health.ok).toBe(true);
    expect(health.modelVersion).toBe('c-radiov3-b-int8-512-dinov2-v1');
    expect(health.modelVersion).toBe(model.modelVersion);
    expect(health.time).toBeGreaterThanOrEqual(before);
  });
});

describe('schema', () => {
  it('loads the tables and indexes in the test harness', async () => {
    const t = convexTest(schema, modules);
    const museumId = await t.run((ctx) =>
      ctx.db.insert('museums', {
        name: 'Museum of Modern Art',
        lat: 40.7614,
        lng: -73.9776,
        seedSource: 'wikidata',
        wikidataId: 'Q160236',
        region: 'us-ny',
        optOut: false,
        useTavilyCrawl: false,
        queuePriority: 0,
        indexStatus: { status: 'none', pagesMapped: 0, worksIndexed: 0, updatedAt: 0 },
      })
    );

    const found = await t.run((ctx) =>
      ctx.db
        .query('museums')
        .withIndex('by_wikidataId', (q) => q.eq('wikidataId', 'Q160236'))
        .unique()
    );

    expect(found?._id).toBe(museumId);
    expect(found?.indexStatus.status).toBe('none');
  });
});
