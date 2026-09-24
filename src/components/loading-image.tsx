import { Image, type ImageProps } from "expo-image";
import { useState } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Gallery } from "@/constants/theme";
import { reportError } from "@/lib/observability";
import { ImageSkeleton } from "./loading-skeleton";

type Props = Pick<ImageProps, "contentFit" | "onLoad" | "onError"> & {
  uri: string;
  label: string;
  style: StyleProp<ViewStyle>;
};

export function LoadingImage(props: Props) {
  return <ImageContent key={props.uri} {...props} />;
}

function ImageContent({ uri, label, style, contentFit = "cover", onLoad, onError }: Props) {
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  return (
    <View style={[{ overflow: "hidden" }, style]}>
      {state === "failed" ? (
        <View
          accessible
          accessibilityRole="image"
          accessibilityLabel={`${label}: image unavailable`}
          style={[
            StyleSheet.absoluteFill,
            {
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: Gallery.fill,
            },
          ]}
        >
          <Image source="sf:photo" accessible={false} tintColor={Gallery.muted} style={{ width: 24, height: 24 }} />
        </View>
      ) : (
        <Image
          source={uri}
          cachePolicy={uri.startsWith("file:") ? "memory" : "disk"}
          accessibilityLabel={label}
          contentFit={contentFit}
          style={StyleSheet.absoluteFill}
          onLoad={(event) => {
            setState("ready");
            onLoad?.(event);
          }}
          onError={(event) => {
            reportError(new Error(event?.error || "Image could not load"), "media.load", {
              level: "warning",
              data: { source: uri.startsWith("file:") ? "local" : "remote" },
            });
            setState("failed");
            onError?.(event);
          }}
        />
      )}
      {state === "loading" && <ImageSkeleton label={`Loading image: ${label}`} style={StyleSheet.absoluteFill} />}
    </View>
  );
}
