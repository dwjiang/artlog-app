import type { FunctionReturnType } from "convex/server";
import { Image } from "expo-image";
import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { ImageSkeleton } from "@/components/loading-skeleton";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { reportError } from "@/lib/observability";

import type { api } from "../../../convex/_generated/api";

type Media = NonNullable<FunctionReturnType<typeof api.walls.getArtwork>>["artwork"]["media"];
type Props = {
  media: Media;
  label: string;
  width: number;
  height?: number;
  token?: string | null;
};

export function DisplayMedia(props: Props) {
  const { media, token } = props;
  let uri: string | undefined;
  if (media.kind === "catalog") {
    uri = media.url;
  } else if (media.kind === "derivative" || media.kind === "photo") {
    const site = process.env.EXPO_PUBLIC_CONVEX_SITE_URL;
    if (site) {
      const url = new URL("/display-media", site);
      const { reference } = media;
      url.searchParams.set("kind", reference.kind);
      url.searchParams.set("itemId", reference.itemId);
      if (reference.kind === "sharedVisit") {
        url.searchParams.set("postId", reference.postId);
      }
      if (reference.photoLocalId) {
        url.searchParams.set("photoLocalId", reference.photoLocalId);
      }
      uri = url.href;
    }
  }
  return <MediaImage key={`${uri ?? "missing"}:${token ?? ""}`} {...props} uri={uri} />;
}

function MediaImage({ media, label, width, height, token, uri }: Props & { uri?: string }) {
  const theme = useTheme();
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const validDimensions =
    Number.isFinite(media.width) && Number.isFinite(media.height) && media.width > 0 && media.height > 0;
  const missing = !uri || failed || !validDimensions;
  const size = {
    width,
    height: height ?? (missing ? width : (width * media.height) / media.width),
  };
  if (missing) {
    return (
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={`${label}: image unavailable`}
        style={{
          ...size,
          backgroundColor: theme.backgroundElement,
          alignItems: "center",
          justifyContent: "center",
          padding: 12,
        }}
      >
        <ThemedText type="small" themeColor="textSecondary">
          Image unavailable
        </ThemedText>
      </View>
    );
  }
  return (
    <View style={size}>
      <Image
        accessible
        accessibilityLabel={label}
        source={{
          uri,
          ...((media.kind === "derivative" || media.kind === "photo") && media.reference.kind !== "wallItem" && token
            ? { headers: { Authorization: `Bearer ${token}` } }
            : {}),
        }}
        style={size}
        contentFit="contain"
        // Protected photos stay in RAM so the wall→detail push reuses the bytes, but never persist to disk;
        // sign-out clears them.
        cachePolicy={media.kind === "derivative" || media.kind === "photo" ? "memory" : "memory-disk"}
        recyclingKey={uri}
        onLoad={() => setLoaded(true)}
        onError={(event) => {
          reportError(new Error(event?.error || "Artwork image could not load"), "media.display", {
            level: "warning",
            data: { kind: media.kind },
          });
          setFailed(true);
        }}
      />
      {!loaded && <ImageSkeleton label={`Loading image: ${label}`} style={StyleSheet.absoluteFill} />}
    </View>
  );
}
