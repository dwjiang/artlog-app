import { afterEach, describe, expect, it, vi } from 'vitest';

import { isEnabled } from './flags';

afterEach(() => vi.unstubAllEnvs());

describe('feature flags', () => {
  it('defaults the label flow on and Right now off', () => {
    expect(isEnabled('labelFlow')).toBe(true);
    expect(isEnabled('rightNow')).toBe(false);
  });

  it('honors explicit on and off values', () => {
    vi.stubEnv('FLAG_LABEL_FLOW', 'off');
    vi.stubEnv('FLAG_RIGHT_NOW', 'on');
    expect(isEnabled('labelFlow')).toBe(false);
    expect(isEnabled('rightNow')).toBe(true);

    vi.stubEnv('FLAG_RIGHT_NOW', 'off');
    expect(isEnabled('rightNow')).toBe(false);
  });

  it('falls back to the default for unrecognized values', () => {
    vi.stubEnv('FLAG_LABEL_FLOW', 'maybe');
    expect(isEnabled('labelFlow')).toBe(true);
  });
});
