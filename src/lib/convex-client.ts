import type { TokenStorage } from '@convex-dev/auth/react';
import { ConvexReactClient } from 'convex/react';
import * as SecureStore from 'expo-secure-store';

const url = process.env.EXPO_PUBLIC_CONVEX_URL;
if (!url) throw new Error('EXPO_PUBLIC_CONVEX_URL is not set; copy .env.example to .env.local');

export const convex = new ConvexReactClient(url, { unsavedChangesWarning: false });

// Auth tokens live in the keychain so the anonymous session survives relaunches.
export const secureStorage: TokenStorage = {
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
  removeItem: (key) => SecureStore.deleteItemAsync(key),
};
