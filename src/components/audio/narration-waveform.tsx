import { View } from "react-native";
import Animated from "react-native-reanimated";

import { Gallery } from "@/constants/theme";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

const pulse = {
  from: { transform: [{ scaleY: 0.2 }] },
  to: { transform: [{ scaleY: 1 }] },
};
const heights = [0.35, 0.6, 0.85, 1, 0.75, 0.5, 0.3];

export function NarrationWaveform({ color = Gallery.accent, size = 32 }: { color?: string; size?: number }) {
  const reduced = useReducedMotion();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: size / 16,
      }}
    >
      {heights.map((height, index) => (
        <Animated.View
          key={index}
          style={{
            width: size / 12,
            height: size * height,
            borderRadius: 2,
            backgroundColor: color,
            ...(reduced
              ? {}
              : {
                  animationName: pulse,
                  animationDuration: "600ms",
                  animationDelay: `${index * -120}ms`,
                  animationTimingFunction: "linear",
                  animationDirection: "alternate",
                  animationIterationCount: "infinite",
                }),
          }}
        />
      ))}
    </View>
  );
}
