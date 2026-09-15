/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { useColorScheme } from 'react-native';

import { Colors } from '@/constants/theme';

export function useTheme() {
  return Colors[useColorScheme() === 'dark' ? 'dark' : 'light'];
}
