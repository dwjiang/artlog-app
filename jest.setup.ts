import { initializeOwner, switchOwner } from './src/lib/account/owner-store';

// Jest does not load .env files; route modules construct the Convex client at import time.
process.env.EXPO_PUBLIC_CONVEX_URL ??= 'https://test.convex.cloud';

// Repository tests use a deterministic installation identity without accessing native storage.
initializeOwner('test-installation');
switchOwner('device:test-installation', 'test-scope');
