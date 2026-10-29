import type { FunctionReturnType } from "convex/server";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";

import { ListRow } from "@/components/list-row";
import { ProfileAvatar } from "@/components/social/profile-avatar";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, Radius, Typography } from "@/constants/theme";
import type { SavedWork } from "@/db/schema";
import { artistLine } from "@/lib/catalog/artist-line";
import { captureFileUri } from "@/lib/files/photos";

import type { api } from "../../../convex/_generated/api";

export type CatalogArtwork = FunctionReturnType<typeof api.artworks.search>["page"][number];
export type ArtistSummary = FunctionReturnType<typeof api.catalog.search>["artists"][number];

const THUMBNAIL = 40;

export const workCount = (count: number) => `${count} ${count === 1 ? "work" : "works"}`;

/** Opens your saved copy of a work you have saved, and its catalog page otherwise. */
export function useOpenCatalogArtwork() {
  const router = useRouter();
  return (artworkId: string, saved?: SavedWork) =>
    saved
      ? router.push({ pathname: "/saved/[savedId]", params: { savedId: saved.localId } })
      : router.push({ pathname: "/catalog/[artworkId]", params: { artworkId } });
}

/** A catalog work's picture in a list: your own photo once it's in your collection, as the collection shows it. */
export function catalogArtworkImage(thumbnailUrl: string | undefined, saved: SavedWork | undefined) {
  return saved?.cropPath ? captureFileUri(saved.cropPath) : thumbnailUrl;
}

export function CatalogThumbnail({ uri }: { uri?: string }) {
  return uri ? (
    <Image
      source={uri}
      cachePolicy={uri.startsWith("file:") ? "memory" : "disk"}
      contentFit="cover"
      accessible={false}
      style={styles.thumbnail}
    />
  ) : (
    <View style={[styles.thumbnail, styles.empty]} />
  );
}

/** A catalog work in a grouped list: your saved works say so and open your copy. */
export function CatalogArtworkRow({
  artwork,
  saved,
  query,
  first,
  last,
  onOpen,
}: {
  artwork: CatalogArtwork;
  saved?: SavedWork;
  query?: string;
  first: boolean;
  last: boolean;
  onOpen?: () => void;
}) {
  const open = useOpenCatalogArtwork();
  const details = artistLine(artwork.artist, artwork.date);
  return (
    <ListRow
      title={artwork.title}
      query={query}
      subtitle={
        <Text style={styles.subtitle} numberOfLines={1}>
          {saved && <Text style={styles.saved}>Saved · </Text>}
          {saved ? artwork.date || artwork.artist : details}
        </Text>
      }
      leading={<CatalogThumbnail uri={catalogArtworkImage(artwork.thumbnailUrl, saved)} />}
      accessory="chevron"
      accessibilityLabel={[artwork.title, details, saved && "Saved"].filter(Boolean).join(", ")}
      first={first}
      last={last}
      onPress={() => {
        onOpen?.();
        open(artwork.artworkId, saved);
      }}
    />
  );
}

/** An artist in a grouped list, with one of their works as the avatar. */
export function ArtistRow({
  artist,
  query,
  first,
  last,
  onOpen,
}: {
  artist: ArtistSummary;
  query?: string;
  first: boolean;
  last: boolean;
  onOpen?: () => void;
}) {
  const router = useRouter();
  return (
    <ListRow
      title={artist.name}
      query={query}
      subtitle={workCount(artist.workCount)}
      leading={<ProfileAvatar photoUrl={artist.coverUrl} size={THUMBNAIL} />}
      accessory="chevron"
      accessibilityLabel={`${artist.name}, ${workCount(artist.workCount)}`}
      first={first}
      last={last}
      onPress={() => {
        onOpen?.();
        router.push({ pathname: "/artist/[artistId]", params: { artistId: artist.artistId } });
      }}
    />
  );
}

const styles = StyleSheet.create({
  thumbnail: { width: THUMBNAIL, height: THUMBNAIL, borderRadius: Radius.thumbnail },
  empty: { backgroundColor: Gallery.fill },
  subtitle: { ...Typography.secondary, color: Gallery.muted },
  saved: { color: Gallery.accent, fontWeight: "600" },
});
