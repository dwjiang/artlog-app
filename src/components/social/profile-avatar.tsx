import { useState } from "react";
import { View } from "react-native";

import { LoadingImage } from "@/components/loading-image";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery } from "@/constants/theme";
import { initials } from "@/lib/social/presentation";

export function ProfileAvatar({ name, photoUrl, size = 40 }: { name: string; photoUrl?: string; size?: number }) {
  const [failed, setFailed] = useState<string>();
  const letters = initials(name);
  return (
    <View
      accessibilityElementsHidden
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        overflow: "hidden",
        backgroundColor: Gallery.avatar,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {photoUrl && failed !== photoUrl ? (
        <LoadingImage
          uri={photoUrl}
          label={`${name} profile photo`}
          contentFit="cover"
          onError={() => setFailed(photoUrl)}
          style={{ width: size, height: size }}
        />
      ) : (
        <Text
          allowFontScaling={false}
          style={{
            fontSize: size * 0.3,
            fontWeight: "600",
            letterSpacing: 0.4,
            color: Gallery.ink,
          }}
        >
          {letters}
        </Text>
      )}
    </View>
  );
}
