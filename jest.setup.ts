// Jest does not load .env files; route modules construct the Convex client at import time.
process.env.EXPO_PUBLIC_CONVEX_URL ??= 'https://test.convex.cloud';
