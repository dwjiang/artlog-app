import { getRandomBytesAsync } from "expo-crypto";

import { installationStorage } from "@/lib/installation-storage";

const DEVICE_AUTH_SECRET = "deviceAuthSecret";

export async function getDeviceAuthSecret(): Promise<string> {
  const stored = await installationStorage.getItem(DEVICE_AUTH_SECRET);
  if (stored !== null) return stored;

  const bytes = await getRandomBytesAsync(32);
  const secret = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  // Persist before signing in so a failed request or process restart reuses the same identity.
  await installationStorage.setItem(DEVICE_AUTH_SECRET, secret);
  return secret;
}
