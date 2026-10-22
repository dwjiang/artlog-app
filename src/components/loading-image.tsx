import { Image, type ImageProps } from "expo-image";
import { useState } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { Gallery, Motion } from "@/constants/theme";
import { reportImageLoadError } from "@/lib/image-load-error";

import { ImageSkeleton } from "./loading-skeleton";

type Props = Pick<ImageProps, "contentFit" | "contentPosition" | "onLoad" | "onDisplay" | "onError"> & {
  uri: string;
  label: string;
  style: StyleProp<ViewStyle>;
};

export function LoadingImage(props: Props) {
  return <ImageContent key={props.uri} {...props} />;
}

function ImageContent({ uri, label, style, contentFit = "cover", contentPosition, onLoad, onDisplay, onError }: Props) {
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
          contentPosition={contentPosition}
          transition={{ duration: Motion.state, effect: "cross-dissolve" }}
          style={StyleSheet.absoluteFill}
          onLoad={(event) => {
            setState("ready");
            onLoad?.(event);
          }}
          onDisplay={onDisplay}
          onError={(event) => {
            reportImageLoadError(uri, event?.error);
            setState("failed");
            onError?.(event);
          }}
        />
      )}
      {state === "loading" && <ImageSkeleton label={`Loading image: ${label}`} style={StyleSheet.absoluteFill} />}
    </View>
  );
}
