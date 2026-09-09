import type { TokenStorage } from '@convex-dev/auth/react';
import { ConvexReactClient } from 'convex/react';

import { installationStorage } from '@/lib/installation-storage';

const url = process.env.EXPO_PUBLIC_CONVEX_URL;
if (!url) throw new Error('EXPO_PUBLIC_CONVEX_URL is not set; copy .env.example to .env.local');

export const convex = new ConvexReactClient(url, { unsavedChangesWarning: false });

export const secureStorage: TokenStorage = installationStorage;
