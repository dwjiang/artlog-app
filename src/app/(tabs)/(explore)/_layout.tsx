import { Stack } from "expo-router/stack";

import { VisitBand } from "@/components/visits/visit-band";
import { LargeTitleHeader, NavigationTheme } from "@/constants/theme";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

export const unstable_settings = {
  anchor: "explore",
};

export default function ExploreLayout() {
  const reduced = useReducedMotion();
  return (
    <>
      <Stack
        screenOptions={{ ...NavigationTheme, animation: reduced ? "fade" : "default", animationMatchesGesture: true }}
      >
        <Stack.Screen name="explore" options={{ ...LargeTitleHeader, title: "Explore" }} />
      </Stack>
      <VisitBand />
    </>
  );
}
