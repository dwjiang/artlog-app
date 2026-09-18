import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View, type ViewProps } from 'react-native';

import { Colors, Gallery } from '@/constants/theme';

export type GlassSurfaceProps = ViewProps & { isInteractive?: boolean };

/** Camera controls keep a dark backing so labels remain legible over bright imagery. */
export function GlassSurface({ isInteractive = false, style, ...rest }: GlassSurfaceProps) {
  const [reduceTransparency, setReduceTransparency] = useState(false);
  useEffect(() => {
    let active = true;
    let receivedChange = false;
    void (async () => {
      const enabled = await AccessibilityInfo.isReduceTransparencyEnabled();
      if (active && !receivedChange) setReduceTransparency(enabled);
    })();
    const subscription = AccessibilityInfo.addEventListener('reduceTransparencyChanged', (enabled) => {
      receivedChange = true;
      setReduceTransparency(enabled);
    });
    return () => { active = false; subscription.remove(); };
  }, []);

  if (reduceTransparency) return <View style={[styles.opaque, style]} {...rest} />;
  if (!isLiquidGlassAvailable()) return <View style={[styles.scrim, style]} {...rest} />;
  return <GlassView glassEffectStyle="regular" colorScheme="dark" tintColor={Colors.light.overlayScrim} isInteractive={isInteractive} style={style} {...rest} />;
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: Colors.light.overlayScrim },
  opaque: { backgroundColor: Gallery.ink },
});
