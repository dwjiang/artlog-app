// Jest does not load .env files; route modules construct the Convex client at import time.
process.env.EXPO_PUBLIC_CONVEX_URL ??= 'https://test.convex.cloud';

// Repository tests use a deterministic installation identity without accessing native storage.
const { initializeOwner, switchOwner } = require('./src/lib/account/owner-store');
initializeOwner('test-installation');
switchOwner('device:test-installation', 'test-scope');
