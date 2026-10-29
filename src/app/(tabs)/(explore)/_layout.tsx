import { Stack } from "expo-router/stack";

import { VisitBand } from "@/components/visits/visit-band";
import { TabTitles } from "@/constants/tabs";
import { NavigationTheme, ScrollTitleHeader } from "@/constants/theme";
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
        {/* The screen draws its own title; the bar keeps only the city chip and its buttons. */}
        <Stack.Screen name="explore" options={{ ...ScrollTitleHeader, title: TabTitles["(explore)"] }} />
      </Stack>
      <VisitBand />
    </>
  );
}
