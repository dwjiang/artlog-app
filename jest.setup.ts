import { initializeOwner, switchOwner } from './src/lib/account/owner-store';

jest.mock('@sentry/react-native', () => ({ init: jest.fn(), wrap: (component: unknown) => component }));

// Native CSS animations are verified on iOS; Jest exercises their content and accessibility states.
jest.mock('react-native-reanimated', () => ({ __esModule: true, default: { View: jest.requireActual('react-native').View }, isSharedValue: () => false, getUseOfValueInStyleWarning: () => '' }));

// Jest does not load .env files; route modules construct the Convex client at import time.
process.env.EXPO_PUBLIC_CONVEX_URL ??= 'https://test.convex.cloud';

// Repository tests use a deterministic installation identity without accessing native storage.
initializeOwner('test-installation');
switchOwner('device:test-installation', 'test-scope');
