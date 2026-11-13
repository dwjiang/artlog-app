import { ConvexHttpClient } from "convex/browser";
import { Paths } from "expo-file-system";
import { getInfoAsync, readAsStringAsync, writeAsStringAsync } from "expo-file-system/legacy";

import { parseIosBuild } from "@/shared/app-compatibility";

import { api } from "../../convex/_generated/api";
import { getInstallationId, installationStorage } from "./installation-storage";
import { reportError } from "./observability";

const storageKey = "appCompatibility";
const cacheUri = () => `${Paths.document.uri.replace(/\/$/, "")}/app-compatibility.json`;
const deployment = process.env.EXPO_PUBLIC_CONVEX_URL!;

function validMinimum(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && parseIosBuild(value) !== null);
}

// `undefined` means this deployment has no usable saved answer, so startup has to wait for the server.
export async function readCachedMinimum(): Promise<string | null | undefined> {
  try {
    const uri = cacheUri();
    const { exists } = await getInfoAsync(uri);
    // Read the legacy cache until the first successful file write.
    const stored = exists ? await readAsStringAsync(uri) : await installationStorage.getItem(storageKey);
    if (stored === null) return undefined;
    const cached: unknown = JSON.parse(stored);
    if (
      typeof cached !== "object"
      || cached === null
      || !("deployment" in cached)
      || cached.deployment !== deployment
      || (exists && (!("installation" in cached) || cached.installation !== getInstallationId()))
    ) {
      return undefined;
    }
    if (!("minimum" in cached) || !validMinimum(cached.minimum)) throw new Error("Invalid cached app compatibility");
    return cached.minimum;
  } catch (cause) {
    reportError(cause, "app-update.read-cache");
    return undefined;
  }
}

export async function cacheMinimum(minimum: string | null): Promise<void> {
  try {
    // The policy is public, and the iOS file API atomically replaces the previous offline answer.
    await writeAsStringAsync(cacheUri(), JSON.stringify({ installation: getInstallationId(), deployment, minimum }));
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
