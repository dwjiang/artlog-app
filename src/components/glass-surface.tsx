import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { StyleSheet, View, type ViewProps } from "react-native";

import { Colors, Gallery } from "@/constants/theme";
import { useReduceTransparency } from "@/hooks/use-reduce-transparency";

export type GlassSurfaceProps = ViewProps & { isInteractive?: boolean; tone?: "dark" | "light" };

/**
 * Camera controls keep a dark backing so labels remain legible over bright imagery; `light` glass carries ink and
 * accent labels over the wall.
 */
export function GlassSurface({ isInteractive = false, tone = "dark", style, ...rest }: GlassSurfaceProps) {
  const reduceTransparency = useReduceTransparency();
  const light = tone === "light";

  if (reduceTransparency) {
    return <View style={[light ? styles.lightOpaque : styles.opaque, style]} {...rest} />;
  }
  if (!isLiquidGlassAvailable()) {
    return <View style={[light ? styles.lightScrim : styles.scrim, style]} {...rest} />;
  }
  return (
    <GlassView
      glassEffectStyle="regular"
      colorScheme={tone}
      tintColor={light ? LIGHT_TINT : Colors.light.overlayScrim}
      isInteractive={isInteractive}
      style={style}
      {...rest}
    />
  );
}

// Untinted light glass turns mid-gray over a dark wall, too dim for accent labels.
const LIGHT_TINT = "rgba(255, 255, 255, 0.8)";

const styles = StyleSheet.create({
  scrim: { backgroundColor: Colors.light.overlayScrim },
  opaque: { backgroundColor: Gallery.ink },
  lightScrim: { backgroundColor: "rgba(255, 255, 255, 0.88)" },
  lightOpaque: { backgroundColor: Gallery.surface },
});
