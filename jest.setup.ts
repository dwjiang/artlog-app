import type { ViewProps } from "react-native";

import { initializeOwner, switchOwner } from "./src/lib/account/owner-store";

// Frame geometry has pure tests; native texture rendering is checked on iOS.
jest.mock("@shopify/react-native-skia", () => ({
  Canvas: jest.requireActual("react-native").View,
  Picture: jest.requireActual("react-native").View,
  useImage: () => null,
}));

jest.mock("@react-native-google-signin/google-signin", () => {
  return {
    GoogleSignin: { configure: jest.fn(), signIn: jest.fn(), signOut: jest.fn() },
    isCancelledResponse: (result: { type: string }) => result.type === "cancelled",
  };
});

jest.mock("@sentry/react-native", () => ({
  init: jest.fn(),
  wrap: (component: unknown) => component,
  captureException: jest.fn(),
  addBreadcrumb: jest.fn(),
  setTag: jest.fn(),
  reactNavigationIntegration: () => ({ registerNavigationContainer: jest.fn() }),
  Mask: ({ children, ...props }: ViewProps) =>
    jest
      .requireActual("react")
      .createElement(jest.requireActual("react-native").View, { ...props, testID: "replay-mask" }, children),
}));

// Native CSS animations are verified on iOS; Jest exercises their content and accessibility states.
jest.mock("react-native-reanimated", () => ({
  ...jest.requireActual("react-native-reanimated/mock"),
  __esModule: true,
  createAnimatedComponent: (component: unknown) => component,
  cubicBezier: (...points: number[]) => points,
  default: {
    createAnimatedComponent: (component: unknown) => component,
    View: jest.requireActual("react-native").View,
    ScrollView: jest.requireActual("react-native").ScrollView,
    FlatList: jest.requireActual("react-native").FlatList,
  },
  isSharedValue: () => false,
  getUseOfValueInStyleWarning: () => "",
  useAnimatedRef: () => jest.requireActual("react").useRef(null),
  useAnimatedStyle: () => ({}),
  LayoutAnimationConfig: ({ children }: { children: unknown }) => children,
}));

// expo-router/testing-library swaps in Reanimated's official mock, which needs Worklets' mock to load.
jest.mock("react-native-worklets", () => jest.requireActual("react-native-worklets/lib/module/mock"));

// Router tests replace the mock above; the upstream mock omits these Reanimated 4 exports.
jest.mock("react-native-reanimated/mock", () => ({
  ...jest.requireActual("react-native-reanimated/mock"),
  createAnimatedComponent: (component: unknown) => component,
  cubicBezier: (...points: number[]) => points,
  LayoutAnimationConfig: ({ children }: { children: unknown }) => children,
}));

// The keyboard accessory's native view config is missing under the test renderer; its children render in place.
jest.mock("react-native/Libraries/Components/TextInput/InputAccessoryView", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => children,
}));

// Link previews and menus are native iOS views that only mount under the bridgeless runtime; Jest renders the
// link's trigger and leaves the menu to the simulator.
jest.mock("expo-router/build/link/preview/native", () => ({
  ...jest.requireActual("expo-router/build/link/preview/native"),
  NativeLinkPreview: ({ children }: { children: unknown }) => children,
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

// expo-notifications warns about Expo Go on import and reaches native modules from Home, Settings, and social flows.
jest.mock("expo-notifications", () => ({
  IosAuthorizationStatus: { NOT_DETERMINED: 0, DENIED: 1, AUTHORIZED: 2, PROVISIONAL: 3, EPHEMERAL: 4 },
  SchedulableTriggerInputTypes: { DATE: "date" },
  DEFAULT_ACTION_IDENTIFIER: "expo.modules.notifications.actions.DEFAULT",
  getPermissionsAsync: jest.fn(async () => ({ status: "undetermined", granted: false, ios: { status: 0 } })),
  requestPermissionsAsync: jest.fn(async () => ({ status: "denied", granted: false, ios: { status: 1 } })),
  getExpoPushTokenAsync: jest.fn(async () => ({ type: "expo", data: "ExponentPushToken[test]" })),
  setBadgeCountAsync: jest.fn(async () => true),
  scheduleNotificationAsync: jest.fn(async () => "scheduled"),
  getAllScheduledNotificationsAsync: jest.fn(async () => []),
  cancelScheduledNotificationAsync: jest.fn(async () => {}),
  setNotificationHandler: jest.fn(),
  useLastNotificationResponse: jest.fn(() => null),
  clearLastNotificationResponse: jest.fn(),
}));

// Components render without the provider Expo Router mounts; router tests still read its insets.
jest.mock("react-native-safe-area-context", () => {
  const actual = jest.requireActual("react-native-safe-area-context");
  const { useContext } = jest.requireActual("react");
  return {
    ...actual,
    useSafeAreaInsets: () => useContext(actual.SafeAreaInsetsContext) ?? { top: 0, right: 0, bottom: 0, left: 0 },
  };
});

// Jest does not load .env files; route modules construct the Convex client at import time.
process.env.EXPO_PUBLIC_CONVEX_URL ??= "https://test.convex.cloud";

// Repository tests use a deterministic installation identity without accessing native storage.
initializeOwner("test-installation");
switchOwner("device:test-installation", "test-scope");
