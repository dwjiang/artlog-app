import { useNavigation } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { VisitBar } from '@/components/visits/visit-bar';
import { TabBarVisibility } from '@/components/tab-bar-visibility';
import { BottomTabInset, Gallery } from '@/constants/theme';
import { useVenue } from '@/lib/venue/use-venue';

export const unstable_settings = {
  anchor: '(home)',
};

type RouteState = { index?: number; routes: { name: string; state?: RouteState }[] };

/** The tab navigator's state, nested under expo-router's `__root` route and any wrapper above the tabs. */
function findTabsState(state: RouteState | undefined): RouteState | undefined {
  for (const route of state?.routes ?? []) {
    if (route.name === '(tabs)') return route.state;
    const nested = findTabsState(route.state);
    if (nested) return nested;
  }
  return undefined;
}

/** The selected tab, unchanged while a sheet or modal sits above the tabs. Reads the parent stack's state and follows its changes. */
function useSelectedTab(): string | undefined {
  const navigation = useNavigation();
  const [tabs, setTabs] = useState(() => findTabsState(navigation.getState() as RouteState | undefined));
  useEffect(() => navigation.addListener('state', (event) => {
    setTabs(findTabsState((event.data as { state?: RouteState }).state));
  }), [navigation]);
  return tabs?.routes[tabs.index ?? 0]?.name;
}

export default function TabsLayout() {
  const { bottom } = useSafeAreaInsets();
  const [hidden, setHidden] = useState(false);
  const { visit } = useVenue();
  const selectedTab = useSelectedTab();
  // The camera has the venue pill; the bar there would crowd the shutter.
  const showVisitBar = !!visit && selectedTab !== '(scan)' && !hidden;
  return (
    <TabBarVisibility value={setHidden}>
    <View style={{ flex: 1 }}>
    <NativeTabs minimizeBehavior="never" hidden={hidden} tintColor={Gallery.accent} backgroundColor={Gallery.paper}>
      <NativeTabs.Trigger name="(home)">
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(scan)">
        <NativeTabs.Trigger.Label>Scan</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="camera.viewfinder" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(collection)">
        <NativeTabs.Trigger.Label>Collection</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'square.grid.2x2', selected: 'square.grid.2x2.fill' }}
        />
      </NativeTabs.Trigger>
    </NativeTabs>
    {showVisitBar && <View pointerEvents="box-none" style={{ position: 'absolute', left: 20, right: 20, bottom: bottom + BottomTabInset + 12 }}><VisitBar /></View>}
    </View>
    </TabBarVisibility>
  );
}
