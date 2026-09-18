import { Platform, type TextStyle } from 'react-native';
import { DEFAULT_WALL_COLOR } from '@/shared/wall/defaults';

export const Gallery = {
  ink: '#111111',
  muted: '#6A6B70',
  paper: '#FCFCF9',
  surface: '#FFFFFF',
  fill: '#F0F0EC',
  avatar: '#D7D7D8',
  accent: '#0A46F3',
  accentPressed: '#0836C4',
  highlight: '#DFF64D',
  segmentTrack: '#FFFFFF',
  segmentSelection: '#DFF64D',
  separator: '#CDCDD0',
  controlBorder: '#111111',
  success: '#2F6846',
  warning: '#865A15',
  destructive: '#B42318',
  sage: '#CDD0CA',
  colors: [
    { name: 'Paper', value: DEFAULT_WALL_COLOR },
    { name: 'Sage', value: '#CDD0CA' },
    { name: 'Forest', value: '#45524B' },
    { name: 'Slate', value: '#4C5B6B' },
    { name: 'Burgundy', value: '#6C2F2B' },
    { name: 'Plum', value: '#524650' },
    { name: 'Limestone', value: '#E2DCD0' },
    { name: 'Chalk', value: '#EDECE7' },
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
    overlayScrim: 'rgba(17, 17, 17, 0.72)',
    overlayText: '#FFFFFF',
  },
  dark: {
    text: '#ffffff',
    background: '#000000',
    backgroundElement: '#212225',
    backgroundSelected: '#2E3135',
    textSecondary: '#B0B4BA',
    accent: '#208AEF',
    success: '#34C759',
    warning: '#FF9500',
    overlayScrim: 'rgba(0, 0, 0, 0.55)',
    overlayText: '#ffffff',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light;

export const Fonts = {
  sans: 'system-ui',
  display: 'Anton',
  serif: 'ui-serif',
  rounded: 'ui-rounded',
  mono: 'ui-monospace',
} as const;

export const Typography = {
  wordmark: { fontFamily: Fonts.display, fontSize: 64, lineHeight: 72 },
  largeTitle: { fontSize: 34, lineHeight: 41, fontWeight: '700' },
  display: { fontFamily: Fonts.display, fontSize: 32, lineHeight: 38 },
  section: { fontFamily: Fonts.display, fontSize: 20, lineHeight: 26 },
  body: { fontSize: 17, lineHeight: 25 },
  secondary: { fontSize: 15, lineHeight: 22 },
  metadata: { fontSize: 13, lineHeight: 18 },
  button: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
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

export const Radius = { artwork: 0, thumbnail: 2, button: 8, input: 8, full: 9999 } as const;

export const NavigationTheme = {
  headerTintColor: Gallery.accent,
  headerStyle: { backgroundColor: Gallery.paper },
  headerTitleStyle: { color: Gallery.ink },
  headerLargeTitleStyle: { color: Gallery.ink },
  headerShadowVisible: false,
  contentStyle: { backgroundColor: Gallery.paper },
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
