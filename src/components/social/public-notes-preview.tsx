import { useState } from "react";
import { ScrollView, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { WallSheet } from "@/components/collection/wall-sheet";
import { ThemedText as Text } from "@/components/themed-text";
import type { PublicWall } from "@/lib/social/types";
import { useSocialQuery } from "@/lib/social/use-social-query";
import { useSocialSession } from "@/lib/social/use-social-session";

import { api } from "../../../convex/_generated/api";
import { PublicProfileHeader, PublicWallView } from "./public-wall-view";
import { PublishedArtwork } from "./published-artwork";
import { SocialState } from "./social-state";
import { socialStyles } from "./social-styles";

export function PublicNotesPreview({ wall }: { wall: PublicWall }) {
  const session = useSocialSession();
  const [selectedId, setSelectedId] = useState<string>();
  const selected = wall.items.find((item) => item.itemId === selectedId);
  const profile = useSocialQuery(api.profiles.getPublic, { profileId: wall.profileId }, session.key);
  const detail = useSocialQuery(api.walls.getArtwork, selected ? { itemId: selected.itemId } : "skip", session.key);
  return (
    <GestureHandlerRootView style={{ flexGrow: 0 }}>
      <View style={{ paddingHorizontal: 20, paddingBottom: 16, gap: 6 }}>
        <Text style={socialStyles.caption}>VISITOR PREVIEW · UNSAVED CHOICES</Text>
        <Text style={socialStyles.caption}>Tap an artwork to see its shared note.</Text>
      </View>
      {profile.data ? (
        <PublicProfileHeader person={profile.data} />
      ) : (
        <SocialState
          title={profile.error ? "Couldn’t load your profile." : "Opening profile…"}
          loading={!profile.error}
          action={profile.error ? "Try again" : undefined}
          onAction={profile.refresh}
        />
      )}
      <PublicWallView wall={wall} onSelect={(item) => setSelectedId(item.itemId)} />
      {selected && (
        <WallSheet
          title="Visitor preview"
          dismissLabel="Back to wall"
          size="large"
          onDismiss={() => setSelectedId(undefined)}
        >
          <ScrollView contentContainerStyle={{ paddingBottom: 30 }}>
            <PublishedArtwork
              key={selected.itemId}
              artwork={selected.artwork}
              photos={[selected.artwork.media]}
              frame={selected.layout.frame}
              token={session.token}
              note={selected.note}
              enrichment={detail.data?.enrichment}
            />
          </ScrollView>
        </WallSheet>
      )}
    </GestureHandlerRootView>
  );
}
