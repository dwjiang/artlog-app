import { useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { WallGallery } from "@/components/collection/wall-gallery";
import { EmptyState } from "@/components/empty-state";
import { EmptyFrames } from "@/components/empty-state-art";
import type { PublicWall } from "@/lib/social/types";

export function PublicWallView({
  wall,
  arrangedBy,
  onSelect,
}: {
  wall: PublicWall;
  arrangedBy?: string;
  onSelect: (item: PublicWall["items"][number]) => void;
}) {
  const [width, setWidth] = useState(0);
  const { left, right } = useSafeAreaInsets();
  if (wall.items.length === 0) {
    return (
      <EmptyState
        title="No artworks on this wall yet."
        detail={`${arrangedBy ?? "This person"} hasn’t added any artworks yet.`}
        visual={<EmptyFrames />}
      />
    );
  }
  return (
    <View accessibilityLabel="Public collection wall" onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      {width > 0 && (
        <WallGallery
          width={width - left - right}
          wallpaper={wall}
          pieces={wall.items.map((item) => ({
            localId: item.itemId,
            layout: item.layout,
            artwork: item.artwork,
          }))}
          onSelect={(piece) => {
            const item = wall.items.find((row) => row.itemId === piece.localId);
            if (item) onSelect(item);
          }}
        ></WallGallery>
      )}
    </View>
  );
}
