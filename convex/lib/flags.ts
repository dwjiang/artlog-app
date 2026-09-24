import { env } from "../_generated/server";

export type FeatureFlag = "labelFlow" | "museumSearch" | "rightNow";

// "Right now" defaults off because retrieval often returned stale or unrelated events.
const flags: Record<FeatureFlag, { variable: keyof typeof env; defaultOn: boolean }> = {
  labelFlow: { variable: "FLAG_LABEL_FLOW", defaultOn: true },
  museumSearch: { variable: "FLAG_MUSEUM_SEARCH", defaultOn: true },
  rightNow: { variable: "FLAG_RIGHT_NOW", defaultOn: false },
};

export function isEnabled(flag: FeatureFlag): boolean {
  const { variable, defaultOn } = flags[flag];
  const value = env[variable];
  if (value === "on") return true;
  if (value === "off") return false;
  return defaultOn;
}
