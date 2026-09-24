import { Image } from "expo-image";
import { View, type ViewProps } from "react-native";
import Animated from "react-native-reanimated";
import { Gallery } from "@/constants/theme";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

const arc = {
  uri: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M 12 2 A 10 10 0 1 1 2 12" fill="none" stroke="black" stroke-width="2.5" stroke-linecap="round"/></svg>')}`,
};
const rotation = {
  from: { transform: [{ rotate: "0deg" }] },
  to: { transform: [{ rotate: "360deg" }] },
};

export function LoadingRing({
  size = 20,
  color = Gallery.accent,
  accessibilityLabel = "Loading",
  style,
  ...props
}: ViewProps & {
  size?: number;
  color?: string;
}) {
  const reduced = useReducedMotion();
  const diameter = size;
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ busy: true }}
      {...props}
      style={[{ alignItems: "center", justifyContent: "center" }, style]}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ width: diameter, height: diameter }}
      >
        <View
          style={{
            position: "absolute",
            inset: diameter / 24,
            borderRadius: diameter,
            borderWidth: (diameter * 2.5) / 24,
            borderColor: color,
            opacity: 0.14,
          }}
        />
        <Animated.View
          style={{
            width: diameter,
            height: diameter,
            ...(reduced
              ? {}
              : {
                  animationName: rotation,
                  animationDuration: "900ms",
                  animationTimingFunction: "linear",
                  animationIterationCount: "infinite",
                }),
          }}
        >
          <Image source={arc} tintColor={color} accessible={false} style={{ width: diameter, height: diameter }} />
        </Animated.View>
      </View>
    </View>
  );
}
