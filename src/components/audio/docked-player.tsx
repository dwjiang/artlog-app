import type { ReactNode } from "react";
import { View } from "react-native";
import { SafeAreaInsetsContext, useSafeAreaInsets } from "react-native-safe-area-context";

import { Gallery } from "@/constants/theme";
import { useHasListeningTrack } from "@/lib/audio/use-listening";

import { MiniPlayer } from "./mini-player";

/**
 * Pushed screens cover the tab bar and its mini player, so each carries its own player along its bottom edge. Inside the
 * screen it slides with the page; a player under the whole stack would resize the screens beneath it mid-transition.
 * The player pads for the home indicator, so the screen's content drops that inset. Native modals and the tabs keep
 * their children unwrapped: form sheets size only a first-child scroll view.
 */
export function DockedPlayerLayout({ dockable, children }: { dockable: boolean; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const docked = useHasListeningTrack() && dockable;
  if (!dockable) return children;
  return (
    <View style={{ flex: 1 }}>
      <SafeAreaInsetsContext.Provider value={docked ? { ...insets, bottom: 0 } : insets}>
        {children}
      </SafeAreaInsetsContext.Provider>
      {docked && (
        <View
          style={{
            paddingHorizontal: 20,
            paddingTop: 8,
            paddingBottom: Math.max(8, insets.bottom),
            backgroundColor: Gallery.paper,
          }}
        >
          <View
            style={{
              borderWidth: 1,
              borderColor: Gallery.softBorder,
              borderRadius: 12,
              overflow: "hidden",
            }}
          >
            <MiniPlayer />
          </View>
        </View>
      )}
    </View>
  );
}
