import { useSegments } from "expo-router";
import type { ReactNode } from "react";
import { View } from "react-native";
import { SafeAreaInsetsContext, useSafeAreaInsets } from "react-native-safe-area-context";

import { Gallery } from "@/constants/theme";
import { useHasListeningTrack } from "@/lib/audio/use-listening";

import { MiniPlayer } from "./mini-player";

function usePlayerDocked() {
  const segments = useSegments();
  const listening = useHasListeningTrack();
  return listening && segments[0] !== "(tabs)" && segments[0] !== "now-playing";
}

export function ListeningRoot({ children }: { children: ReactNode }) {
  const dock = usePlayerDocked();
  const { bottom } = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: Gallery.paper }}>
      <View style={{ flex: 1 }}>{children}</View>
      {dock && (
        <View
          style={{
            paddingHorizontal: 20,
            paddingTop: 8,
            paddingBottom: Math.max(8, bottom),
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

/** The docked player pads for the home indicator, so pushed screens above it drop that inset; native modals still reach the screen bottom. */
export function DockedPlayerInsets({ modal, children }: { modal: boolean; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const docked = usePlayerDocked() && !modal;
  return (
    <SafeAreaInsetsContext.Provider value={docked ? { ...insets, bottom: 0 } : insets}>
      {children}
    </SafeAreaInsetsContext.Provider>
  );
}
