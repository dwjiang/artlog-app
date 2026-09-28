import { Platform, type TextStyle } from "react-native";

import { DEFAULT_WALL_COLOR } from "@/shared/wall/defaults";

export const Gallery = {
  ink: "#1B2531",
  muted: "#66717C",
  widgetCaption: "#51565B",
  paper: "#FFFFFF",
  groupedBackground: "#F0F3F7",
  surface: "#FFFFFF",
  fill: "#F0F3F7",
  avatar: "#E1E7F2",
  accent: "#254FD4",
  accentPressed: "#1F42B3",
  highlight: "#E8EDFC",
  segmentTrack: "#F0F3F7",
  segmentSelection: "#FFFFFF",
  separator: "#DCE1E8",
  controlBorder: "#8793A2",
  success: "#2F6846",
  warning: "#865A15",
  destructive: "#B42318",
  destructiveFill: "#FFF5F2",
  softBorder: "#DCE1E8",
  accentBorder: "#C4D0F4",
  sage: "#CDD0CA",
  colors: [
    { name: "Paper", value: DEFAULT_WALL_COLOR },
    { name: "Sage", value: "#CDD0CA" },
    { name: "Forest", value: "#45524B" },
    { name: "Slate", value: "#4C5B6B" },
    { name: "Burgundy", value: "#6C2F2B" },
    { name: "Plum", value: "#524650" },
    { name: "Limestone", value: "#E2DCD0" },
    { name: "Chalk", value: "#EDECE7" },
  ],
} as const;

export const Colors = {
  light: {
    text: Gallery.ink,
    background: Gallery.paper,
    backgroundElement: Gallery.fill,
    backgroundSelected: Gallery.highlight,
    textSecondary: Gallery.muted,
    accent: Gallery.accent,
    success: Gallery.success,
    warning: Gallery.warning,
    error: Gallery.destructive,
    controlBorder: Gallery.controlBorder,
    separator: Gallery.separator,
    overlayScrim: "rgba(17, 17, 17, 0.72)",
    overlayText: "#FFFFFF",
  },
  dark: {
    text: "#ffffff",
    background: "#000000",
    backgroundElement: "#212225",
    backgroundSelected: "#2E3135",
    textSecondary: "#B0B4BA",
    accent: "#208AEF",
    success: "#34C759",
    warning: "#FF9500",
    overlayScrim: "rgba(0, 0, 0, 0.55)",
    overlayText: "#ffffff",
  },
} as const;

export type ThemeColor = keyof typeof Colors.light;

export const Fonts = {
  sans: "system-ui",
  display: "SpaceGrotesk-SemiBold",
  serif: "ui-serif",
  rounded: "ui-rounded",
  mono: "ui-monospace",
} as const;

export const Typography = {
  wordmark: { fontFamily: Fonts.display, fontSize: 36, lineHeight: 46, letterSpacing: -1.2 },
  largeTitle: { fontFamily: Fonts.display, fontSize: 34, lineHeight: 44, letterSpacing: -1 },
  display: { fontFamily: Fonts.display, fontSize: 30, lineHeight: 39, letterSpacing: -0.8 },
  pageTitle: { fontFamily: Fonts.display, fontSize: 35, lineHeight: 45, letterSpacing: -1 },
  section: { fontFamily: Fonts.display, fontSize: 20, lineHeight: 26, letterSpacing: -0.4 },
  body: { fontSize: 16, lineHeight: 24 },
  secondary: { fontSize: 14, lineHeight: 21 },
  metadata: { fontSize: 12, lineHeight: 18 },
  button: { fontSize: 16, lineHeight: 22, fontWeight: "600" },
} as const satisfies Record<string, TextStyle>;

export type TextRole = keyof typeof Typography;

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  compact: 12,
  three: 16,
  content: 20,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const Radius = {
  artwork: 0,
  thumbnail: 2,
  button: 6,
  input: 6,
  card: 12,
  sheet: 16,
  full: 9999,
} as const;

export const SettingsOutline = {
  borderWidth: 0.5,
  borderColor: Gallery.separator,
  borderRadius: Radius.card,
} as const;

export const NavigationTheme = {
  headerTintColor: Gallery.accent,
  headerStyle: { backgroundColor: Gallery.paper },
  headerTitleStyle: { color: Gallery.ink },
  headerLargeTitleStyle: { color: Gallery.ink, fontFamily: Fonts.display },
  headerShadowVisible: false,
  contentStyle: { backgroundColor: Gallery.paper },
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
