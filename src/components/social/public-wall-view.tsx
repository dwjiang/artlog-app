import { type ReactNode, useState } from "react";
import { View } from "react-native";

import { WallGallery } from "@/components/collection/wall-gallery";
import { EmptyState } from "@/components/empty-state";
import { ArtworkCollage } from "@/components/guest/artwork-preview";
import { ThemedText as Text } from "@/components/themed-text";
import type { PublicProfile, PublicWall } from "@/lib/social/types";

import { ProfileAvatar } from "./profile-avatar";
import { ProfileBio } from "./profile-bio";
import { socialStyles } from "./social-styles";

export function PublicProfileHeader({
  person,
  actions,
  children,
  visitCount,
}: {
  person: PublicProfile;
  visitCount?: number;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <View
      style={{
        paddingHorizontal: 20,
        paddingTop: 4,
        paddingBottom: 12,
        gap: 12,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
        <ProfileAvatar name={person.name} photoUrl={person.photoUrl} size={64} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text variant="display" accessibilityRole="header">
            {person.name}
          </Text>
          <Text style={socialStyles.caption}>@{person.username}</Text>
        </View>
      </View>
      <ProfileBio text={person.bio} />
      <View style={{ flexDirection: "row", gap: 36 }}>
        <View>
          <Text variant="display">{person.publishedWallCount}</Text>
          <Text style={socialStyles.caption}>artworks</Text>
        </View>
        {visitCount !== undefined && (
          <View>
            <Text variant="display">{visitCount}</Text>
            <Text style={socialStyles.caption}>visits</Text>
          </View>
        )}
      </View>
      {actions && <View>{actions}</View>}
      {children}
    </View>
  );
}

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
  if (wall.items.length === 0) {
    return (
      <EmptyState
        title="No artworks on this wall yet."
        detail={`${arrangedBy ?? "This person"} hasn’t added any artworks yet.`}
        visual={<ArtworkCollage />}
      />
    );
  }
  return (
    <View accessibilityLabel="Public collection wall" onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      {width > 0 && (
        <WallGallery
          width={width}
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
      <Text style={{ ...socialStyles.caption, padding: 20, lineHeight: 18 }}>
        {wall.artworkCount} {wall.artworkCount === 1 ? "artwork" : "artworks"}
        {arrangedBy ? ` · arranged by ${arrangedBy}` : ""}. Only notes selected for public display appear here.
      </Text>
    </View>
  );
}
