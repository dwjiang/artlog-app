import { Stack } from "expo-router/stack";

import { NavigationTheme } from "@/constants/theme";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

export const unstable_settings = {
  anchor: "collection",
};

export default function CollectionLayout() {
  const reduced = useReducedMotion();
  return (
    <Stack
      screenOptions={{ ...NavigationTheme, animation: reduced ? "fade" : "default", animationMatchesGesture: true }}
    >
      <Stack.Screen name="collection" options={{ title: "Collection", headerShown: false }} />
      <Stack.Screen name="visit-place" options={{ title: "Visits by museum" }} />
    </Stack>
  );
}
