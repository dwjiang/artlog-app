export type FeatureFlag = 'labelFlow' | 'museumSearch' | 'rightNow';

// "Right now" defaults off per docs/decisions/007-tavily.md; the label flow and museum-site search default on.
const flags: Record<FeatureFlag, { env: string; defaultOn: boolean }> = {
  labelFlow: { env: 'FLAG_LABEL_FLOW', defaultOn: true },
  museumSearch: { env: 'FLAG_MUSEUM_SEARCH', defaultOn: true },
  rightNow: { env: 'FLAG_RIGHT_NOW', defaultOn: false },
};

export function isEnabled(flag: FeatureFlag): boolean {
  const { env, defaultOn } = flags[flag];
  const value = process.env[env];
  if (value === 'on') return true;
  if (value === 'off') return false;
  return defaultOn;
}
