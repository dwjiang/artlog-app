import { Stack } from "expo-router/stack";
import { useState } from "react";

import { NowCardScrolledAway } from "@/components/visits/now-card";
import { VisitBand } from "@/components/visits/visit-band";
import { LargeTitleHeader, NavigationTheme } from "@/constants/theme";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

export default function HomeLayout() {
  const reduced = useReducedMotion();
  const [nowCardAway, setNowCardAway] = useState(false);
  return (
    <NowCardScrolledAway value={setNowCardAway}>
      <Stack
        screenOptions={{ ...NavigationTheme, animation: reduced ? "fade" : "default", animationMatchesGesture: true }}
      >
        <Stack.Screen name="index" options={{ ...LargeTitleHeader, title: "Artlog" }} />
      </Stack>
      {/* Home carries the visit on its Now card until the card scrolls away. */}
      {nowCardAway && <VisitBand />}
    </NowCardScrolledAway>
  );
}
