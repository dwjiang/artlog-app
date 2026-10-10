import { env } from "../_generated/server";

export type FeatureFlag = "labelFlow" | "rightNow" | "demoActivity" | "exhibitionRefresh";

// "Right now" defaults off because retrieval can return stale or unrelated events.
const flags: Record<FeatureFlag, { variable: keyof typeof env; defaultOn: boolean }> = {
  labelFlow: { variable: "FLAG_LABEL_FLOW", defaultOn: true },
  rightNow: { variable: "FLAG_RIGHT_NOW", defaultOn: false },
  // The demo bot's kill switch: its operations answer `feature_off` until a deployment opts in.
  demoActivity: { variable: "FLAG_DEMO_ACTIVITY", defaultOn: false },
  // Reading museum sites in the background is paid work a deployment opts into.
  exhibitionRefresh: { variable: "FLAG_EXHIBITION_REFRESH", defaultOn: false },
};

export function isEnabled(flag: FeatureFlag): boolean {
  const { variable, defaultOn } = flags[flag];
  const value = env[variable];
  if (value === "on") return true;
  if (value === "off") return false;
  return defaultOn;
}
