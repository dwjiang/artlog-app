import { Stack } from "expo-router/stack";

import { LargeTitleHeader, NavigationTheme } from "@/constants/theme";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

export const unstable_settings = {
  anchor: "search",
};

export default function SearchLayout() {
  const reduced = useReducedMotion();
  return (
    <Stack
      screenOptions={{ ...NavigationTheme, animation: reduced ? "fade" : "default", animationMatchesGesture: true }}
    >
      <Stack.Screen name="search" options={{ ...LargeTitleHeader, title: "Search" }} />
    </Stack>
  );
}
