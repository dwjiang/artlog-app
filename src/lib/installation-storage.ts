import { randomUUID } from 'expo-crypto';
import { File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';

let installationId: string | undefined;

export function getInstallationId(): string {
  if (installationId === undefined) {
    // Documents survive updates but are removed on uninstall; Keychain entries are not.
    const file = new File(Paths.document, 'installation-id');
    const stored = file.exists ? file.textSync() : '';
    const id = stored || randomUUID();
    if (!stored) file.write(id);
    installationId = id;
  }
  return installationId;
}

function storageKey(key: string): string {
  return `${getInstallationId()}.${key}`;
}

export const installationStorage = {
  async getItem(key: string): Promise<string | null> {
    return SecureStore.getItemAsync(storageKey(key));
  },
  async setItem(key: string, value: string): Promise<void> {
    await SecureStore.setItemAsync(storageKey(key), value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  },
  async removeItem(key: string): Promise<void> {
    await SecureStore.deleteItemAsync(storageKey(key));
  },
};
