import { Stack } from "expo-router/stack";
import { useState } from "react";

import { HOME_TITLE } from "@/components/social/home-screen";
import { NowCardScrolledAway } from "@/components/visits/now-card";
import { VisitBand } from "@/components/visits/visit-band";
import { NavigationTheme, ScrollTitleHeader } from "@/constants/theme";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

export default function HomeLayout() {
  const reduced = useReducedMotion();
  const [nowCardAway, setNowCardAway] = useState(false);
  return (
    <NowCardScrolledAway value={setNowCardAway}>
      <Stack
        screenOptions={{ ...NavigationTheme, animation: reduced ? "fade" : "default", animationMatchesGesture: true }}
      >
        {/* The screen draws its own title; the bar keeps only the feed menu and its buttons. */}
        <Stack.Screen name="index" options={{ ...ScrollTitleHeader, title: HOME_TITLE }} />
      </Stack>
      {/* Home carries the visit on its Now card until the card scrolls away. */}
      {nowCardAway && <VisitBand beforeVisit />}
    </NowCardScrolledAway>
  );
}
