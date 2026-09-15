/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#000000',
    background: '#ffffff',
    backgroundElement: '#F0F0F3',
    backgroundSelected: '#E0E1E6',
    textSecondary: '#60646C',
    accent: '#208AEF',
    success: '#34C759',
    warning: '#FF9500',
    overlayScrim: 'rgba(0, 0, 0, 0.55)',
    overlayText: '#ffffff',
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

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;

export const Gallery = {
  ink: '#262320',
  muted: '#6A6763',
  paper: '#F2F2EF',
  surface: '#FAFAF6',
  segmentTrack: '#DFE0DA',
  segmentSelection: '#FBFBF8',
  fill: '#E4E4DE',
  sage: '#CDD0CA',
  accent: '#45524B',
  separator: 'rgba(38, 35, 32, 0.16)',
  destructive: '#B42318',
  colors: [
    { name: 'Sage', value: '#CDD0CA' },
    { name: 'Forest', value: '#45524B' },
    { name: 'Slate', value: '#4C5B6B' },
    { name: 'Burgundy', value: '#6C2F2B' },
    { name: 'Plum', value: '#524650' },
    { name: 'Limestone', value: '#E2DCD0' },
    { name: 'Chalk', value: '#EDECE7' },
  ],
} as const;
