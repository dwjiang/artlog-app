import { initializeOwner, switchOwner } from "./src/lib/account/owner-store";

jest.mock("@sentry/react-native", () => ({
  init: jest.fn(),
  wrap: (component: unknown) => component,
  captureException: jest.fn(),
  addBreadcrumb: jest.fn(),
  setTag: jest.fn(),
}));

// Native CSS animations are verified on iOS; Jest exercises their content and accessibility states.
jest.mock("react-native-reanimated", () => ({
  __esModule: true,
  default: { View: jest.requireActual("react-native").View },
  isSharedValue: () => false,
  getUseOfValueInStyleWarning: () => "",
}));

// expo-audio patches its native player class on import, which jest-expo does not mock; route tests load it through the root layout.
jest.mock("expo-audio", () => ({
  createAudioPlayer: jest.fn(),
  setAudioModeAsync: jest.fn(async () => {}),
  useAudioPlayer: jest.fn(() => ({ id: 0 })),
  useAudioPlayerStatus: jest.fn(() => ({
    id: 0,
    isLoaded: false,
    duration: 0,
  })),
}));

// expo-media-library subclasses its native classes on import, which jest-expo does not mock; saving and settings load it.
jest.mock("expo-media-library", () => ({
  Asset: { create: jest.fn() },
  getPermissionsAsync: jest.fn(async () => ({ status: "undetermined", granted: false })),
  requestPermissionsAsync: jest.fn(async () => ({ status: "denied", granted: false })),
}));

// Jest does not load .env files; route modules construct the Convex client at import time.
process.env.EXPO_PUBLIC_CONVEX_URL ??= "https://test.convex.cloud";

// Repository tests use a deterministic installation identity without accessing native storage.
initializeOwner("test-installation");
switchOwner("device:test-installation", "test-scope");
