import { ConvexHttpClient } from "convex/browser";

import { parseIosBuild } from "@/shared/app-compatibility";

import { api } from "../../convex/_generated/api";
import { installationStorage } from "./installation-storage";
import { reportError } from "./observability";

const storageKey = "appCompatibility";
const deployment = process.env.EXPO_PUBLIC_CONVEX_URL!;

function validMinimum(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && parseIosBuild(value) !== null);
}

export async function readCachedMinimum(): Promise<string | null> {
  try {
    const stored = await installationStorage.getItem(storageKey);
    if (stored === null) return null;
    const cached: unknown = JSON.parse(stored);
    if (
      typeof cached !== "object"
      || cached === null
      || !("deployment" in cached)
      || cached.deployment !== deployment
    ) {
      return null;
    }
    if (!("minimum" in cached) || !validMinimum(cached.minimum)) throw new Error("Invalid cached app compatibility");
    return cached.minimum;
  } catch (cause) {
    reportError(cause, "app-update.read-cache");
    return null;
  }
}

export async function cacheMinimum(minimum: string | null): Promise<void> {
  try {
    await installationStorage.setItem(storageKey, JSON.stringify({ deployment, minimum }));
  } catch (cause) {
    reportError(cause, "app-update.write-cache");
  }
}

export async function fetchMinimum(signal: AbortSignal): Promise<string | null> {
  const client = new ConvexHttpClient(deployment, {
    logger: false,
    fetch: (input, init) => fetch(input, { ...init, signal }),
  });
  const minimum = await client.query(api.appCompatibility.get, {});
  if (!validMinimum(minimum)) throw new Error("Invalid app compatibility response");
  return minimum;
}
