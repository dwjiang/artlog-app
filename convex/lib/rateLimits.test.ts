import { describe, expect, it } from 'vitest';

import type { Id } from '../_generated/dataModel';
import { harness } from '../test.helpers';
import { limitDevice, limitKey } from './rateLimits';

describe('rate limits', () => {
  it('rejects the 4th rejection of one work in a day while another work still passes', async () => {
    const t = harness();
    const deviceId = 'device1' as Id<'devices'>;

    for (let i = 0; i < 3; i++) {
      await t.run((ctx) => limitDevice(ctx, 'rejectPerWork', deviceId, 'objectA'));
    }
    await expect(
      t.run((ctx) => limitDevice(ctx, 'rejectPerWork', deviceId, 'objectA'))
    ).rejects.toMatchObject({ data: { code: 'rate_limited', name: 'rejectPerWork' } });
    await expect(
      t.run((ctx) => limitDevice(ctx, 'rejectPerWork', deviceId, 'objectB'))
    ).resolves.toBeNull();
  });

  it('reports when the caller may retry', async () => {
    const t = harness();
    for (let i = 0; i < 3; i++) await t.run((ctx) => limitKey(ctx, 'queueBump', 'device2'));

    const error = await t.run((ctx) => limitKey(ctx, 'queueBump', 'device2')).catch((e) => e);
    expect(error.data.code).toBe('rate_limited');
    expect(error.data.retryAfter).toBeGreaterThan(0);
  });

  it('keys limits per device', async () => {
    const t = harness();
    for (let i = 0; i < 3; i++) await t.run((ctx) => limitKey(ctx, 'queueBump', 'device3'));
    await expect(t.run((ctx) => limitKey(ctx, 'queueBump', 'device4'))).resolves.toBeNull();
  });
});
