import { useNavigation } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { useEffect, useState } from "react";

import { MiniPlayer } from "@/components/audio/mini-player";
import { TabBarVisibility } from "@/components/tab-bar-visibility";
import { VisitBar } from "@/components/visits/visit-bar";
import { VisitPlayerBar } from "@/components/visits/visit-player-bar";
import { Gallery } from "@/constants/theme";
import { useHasListeningTrack } from "@/lib/audio/use-listening";
import { useVenue } from "@/lib/venue/use-venue";

export const unstable_settings = {
  anchor: "(home)",
};

type RouteState = {
  index?: number;
  routes: { name: string; state?: RouteState }[];
};

/** The tab navigator's state, nested under expo-router's `__root` route and any wrapper above the tabs. */
function findTabsState(state: RouteState | undefined): RouteState | undefined {
  for (const route of state?.routes ?? []) {
    if (route.name === "(tabs)") return route.state;
    const nested = findTabsState(route.state);
    if (nested) return nested;
  }
  return undefined;
}

/** The selected tab, unchanged while a sheet or modal sits above the tabs. Reads the parent stack's state and follows its changes. */
function useSelectedTab(): string | undefined {
  const navigation = useNavigation();
  const [tabs, setTabs] = useState(() => findTabsState(navigation.getState() as RouteState | undefined));
  useEffect(
    () =>
      navigation.addListener("state", (event) => {
        setTabs(findTabsState((event.data as { state?: RouteState }).state));
      }),
    [navigation],
  );
  return tabs?.routes[tabs.index ?? 0]?.name;
}

function AccessoryBar({ listening, visit }: { listening: boolean; visit: boolean }) {
  if (listening && visit) return <VisitPlayerBar />;
  return listening ? <MiniPlayer /> : <VisitBar />;
}

export default function TabsLayout() {
  const listening = useHasListeningTrack();
  const [hidden, setHidden] = useState(false);
  const { visit } = useVenue();
  const selectedTab = useSelectedTab();
  // Home carries the visit on its Now card; the bar keeps it in view on the camera and in the collection.
  const showVisitBar = !!visit && selectedTab !== "(home)";
  return (
    <TabBarVisibility value={setHidden}>
      <NativeTabs minimizeBehavior="never" hidden={hidden} tintColor={Gallery.accent} backgroundColor={Gallery.paper}>
        {/* The system slot above the tab bar holds one row, so a visit with narration shares a single bar. */}
        {!hidden && (listening || showVisitBar) && (
          <NativeTabs.BottomAccessory>
            <AccessoryBar listening={listening} visit={showVisitBar} />
          </NativeTabs.BottomAccessory>
        )}
        <NativeTabs.Trigger name="(home)">
          <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf={{ default: "house", selected: "house.fill" }} />
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="(scan)">
          <NativeTabs.Trigger.Label>Scan</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf="camera.viewfinder" />
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="(collection)">
          <NativeTabs.Trigger.Label>Collection</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon
            sf={{
              default: "square.grid.2x2",
              selected: "square.grid.2x2.fill",
            }}
          />
        </NativeTabs.Trigger>
      </NativeTabs>
    </TabBarVisibility>
  );
}
