import { NativeTabs } from "expo-router/unstable-native-tabs";
import { useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { MiniPlayer } from "@/components/audio/mini-player";
import { TabBarVisibility } from "@/components/tab-bar-visibility";
import { VisitBandLayout } from "@/components/visits/visit-band";
import { TabTitles } from "@/constants/tabs";
import { Gallery } from "@/constants/theme";
import { useHasListeningTrack } from "@/lib/audio/use-listening";
import { countBadge, UnseenNotificationCount, useWatchUnseenNotifications } from "@/lib/social/unseen-notifications";

export const unstable_settings = {
  anchor: "(home)",
};

export default function TabsLayout() {
  const listening = useHasListeningTrack();
  const [hidden, setHidden] = useState(false);
  const unseen = useWatchUnseenNotifications();
  const unseenBadge = countBadge(unseen);
  // Outside the tabs' own safe areas, which the visit band extends.
  const { top } = useSafeAreaInsets();
  return (
    <UnseenNotificationCount value={unseen}>
      <VisitBandLayout value={{ windowTop: top, tabBarHidden: hidden }}>
        <TabBarVisibility value={setHidden}>
          <NativeTabs
            minimizeBehavior="never"
            hidden={hidden}
            tintColor={Gallery.accent}
            backgroundColor={Gallery.paper}
          >
            {!hidden && listening && (
              <NativeTabs.BottomAccessory>
                <MiniPlayer />
              </NativeTabs.BottomAccessory>
            )}
            <NativeTabs.Trigger name="(home)">
              <NativeTabs.Trigger.Label>{TabTitles["(home)"]}</NativeTabs.Trigger.Label>
              <NativeTabs.Trigger.Icon sf={{ default: "house", selected: "house.fill" }} />
              {unseenBadge && <NativeTabs.Trigger.Badge>{unseenBadge}</NativeTabs.Trigger.Badge>}
            </NativeTabs.Trigger>
            <NativeTabs.Trigger name="(explore)" hidden={!__DEV__}>
              <NativeTabs.Trigger.Label>{TabTitles["(explore)"]}</NativeTabs.Trigger.Label>
              <NativeTabs.Trigger.Icon sf={{ default: "safari", selected: "safari.fill" }} />
            </NativeTabs.Trigger>
            <NativeTabs.Trigger name="(scan)">
              <NativeTabs.Trigger.Label>{TabTitles["(scan)"]}</NativeTabs.Trigger.Label>
              <NativeTabs.Trigger.Icon sf="camera.viewfinder" />
            </NativeTabs.Trigger>
            <NativeTabs.Trigger name="(collection)">
              <NativeTabs.Trigger.Label>{TabTitles["(collection)"]}</NativeTabs.Trigger.Label>
              <NativeTabs.Trigger.Icon
                sf={{
                  default: "square.grid.2x2",
                  selected: "square.grid.2x2.fill",
                }}
              />
            </NativeTabs.Trigger>
            <NativeTabs.Trigger name="(search)" role="search">
              <NativeTabs.Trigger.Label>{TabTitles["(search)"]}</NativeTabs.Trigger.Label>
            </NativeTabs.Trigger>
          </NativeTabs>
        </TabBarVisibility>
      </VisitBandLayout>
    </UnseenNotificationCount>
  );
}
