import { Pressable, Text } from 'react-native';
import type { GalleryButton as Real } from '../gallery-button';

/** Manual mock for tests that opt in with jest.mock('@/components/collection/gallery-button'): the SwiftUI Host cannot render under Jest. */
export function GalleryButton({ label, accessibilityLabel, onPress, disabled, busy }: Parameters<typeof Real>[0]) {
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityState={{ disabled: !!disabled || !!busy, busy: !!busy }} disabled={disabled || busy} onPress={onPress}><Text>{label}</Text></Pressable>;
}
