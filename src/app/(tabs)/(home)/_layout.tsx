import { Stack } from "expo-router/stack";

import { NavigationTheme } from "@/constants/theme";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

export default function HomeLayout() {
  const reduced = useReducedMotion();
  return (
    <Stack
      screenOptions={{ ...NavigationTheme, animation: reduced ? "fade" : "default", animationMatchesGesture: true }}
    >
      <Stack.Screen name="index" options={{ title: "Home", headerShown: false }} />
    </Stack>
  );
}
