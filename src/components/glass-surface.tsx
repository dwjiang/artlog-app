import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { StyleSheet, View, type ViewProps } from 'react-native';

import { Colors } from '@/constants/theme';

export type GlassSurfaceProps = ViewProps & { isInteractive?: boolean };

/** A control floating over the camera preview: liquid glass on iOS 26, a translucent scrim before it. */
export function GlassSurface({ isInteractive = false, style, ...rest }: GlassSurfaceProps) {
  if (!isLiquidGlassAvailable()) return <View style={[styles.scrim, style]} {...rest} />;
  // Untinted glass turns near-white over a bright gallery wall; the dark tint keeps the white captions legible, as the Camera app's controls are.
  return <GlassView glassEffectStyle="regular" colorScheme="dark" tintColor={Colors.light.overlayScrim} isInteractive={isInteractive} style={style} {...rest} />;
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: Colors.light.overlayScrim },
});
