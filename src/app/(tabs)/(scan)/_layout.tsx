import { Stack } from "expo-router/stack";

import { NavigationTheme } from "@/constants/theme";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

export const unstable_settings = {
  anchor: "scan",
};

export default function ScanLayout() {
  const reduced = useReducedMotion();
  return (
    <Stack
      screenOptions={{ ...NavigationTheme, animation: reduced ? "fade" : "default", animationMatchesGesture: true }}
    >
      <Stack.Screen name="scan" options={{ title: "Scan", headerShown: false }} />
    </Stack>
  );
}
