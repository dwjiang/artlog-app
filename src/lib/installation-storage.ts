import { randomUUID } from "expo-crypto";
import { File, Paths } from "expo-file-system";
import * as SecureStore from "expo-secure-store";
import { AppState } from "react-native";

import { reportError } from "./observability";

let installationId: string | undefined;

export function getInstallationId(): string {
  if (installationId === undefined) {
    // Documents survive updates but are removed on uninstall; Keychain entries are not.
    const file = new File(Paths.document, "installation-id");
    const stored = file.exists ? file.textSync() : "";
    const id = stored || randomUUID();
    if (!stored) file.writeSync(id);
    installationId = id;
  }
  return installationId;
}

/** Continues as a fresh install: keychain items under the previous id are no longer read. */
export function startNewInstallation(): string {
  const id = randomUUID();
  new File(Paths.document, "installation-id").writeSync(id);
  installationId = id;
  return id;
}

function storageKey(key: string): string {
  return `${getInstallationId()}.${key}`;
}

export const installationStorage = {
  async getItem(key: string): Promise<string | null> {
    return SecureStore.getItemAsync(storageKey(key));
  },
  async setItem(key: string, value: string): Promise<void> {
    // Convex Auth also refreshes its token while the app runs in the background on a locked phone,
    // where reading a when-unlocked item fails with "User interaction is not allowed".
    await SecureStore.setItemAsync(storageKey(key), value, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
  },
  async removeItem(key: string): Promise<void> {
    await SecureStore.deleteItemAsync(storageKey(key));
  },
};

function authItem(key: string): string {
  if (key.startsWith("__convexAuthJWT")) return "jwt";
  if (key.startsWith("__convexAuthRefreshToken")) return "refresh";
  if (key.startsWith("__convexAuthOAuthVerifier")) return "verifier";
  if (key.startsWith("__convexAuthServerStateFetchTime")) return "fetch_time";
  return "other";
}

async function reportFailure<T>(stage: "get" | "set" | "remove", key: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    reportError(error, "auth.session_storage", {
      data: { stage, item: authItem(key), app_state: AppState.currentState },
    });
    throw error;
  }
}

// Convex Auth reads the saved session at launch without a catch, so a Keychain failure would leave sign-in
// loading for the whole session with no report.
export const convexAuthStorage = {
  getItem: (key: string) => reportFailure("get", key, () => installationStorage.getItem(key)),
  setItem: (key: string, value: string) => reportFailure("set", key, () => installationStorage.setItem(key, value)),
  removeItem: (key: string) => reportFailure("remove", key, () => installationStorage.removeItem(key)),
};
