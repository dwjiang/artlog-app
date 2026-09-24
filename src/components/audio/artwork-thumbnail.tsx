import { Image } from "expo-image";
import { View } from "react-native";
import { Gallery } from "@/constants/theme";
import { AudioIcon } from "./audio-icon";
export function ArtworkThumbnail({ uri, size = 44 }: { uri?: string; size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: 2,
        overflow: "hidden",
        backgroundColor: Gallery.fill,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {uri ? (
        <Image source={uri} contentFit="cover" style={{ width: "100%", height: "100%" }} />
      ) : (
        <AudioIcon name="photo" color={Gallery.muted} />
      )}
    </View>
  );
}
