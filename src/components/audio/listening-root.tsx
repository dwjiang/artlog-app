import { useSegments } from "expo-router";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ReactNode } from "react";
import { Gallery } from "@/constants/theme";
import { useHasListeningTrack } from "@/lib/audio/use-listening";
import { MiniPlayer } from "./mini-player";
export function ListeningRoot({ children }: { children: ReactNode }) {
  const segments = useSegments();
  const listening = useHasListeningTrack();
  const { bottom } = useSafeAreaInsets();
  const dock =
    listening && segments[0] !== "(tabs)" && segments[0] !== "now-playing";
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
