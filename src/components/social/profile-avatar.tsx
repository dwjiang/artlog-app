import { Image } from "expo-image";
import { useState } from "react";
import { View } from "react-native";

import { LoadingImage } from "@/components/loading-image";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery } from "@/constants/theme";
import { AVATAR_IMAGES } from "@/lib/social/avatar-images";
import { initials } from "@/lib/social/presentation";
import type { AvatarId } from "@/shared/social/avatars";

/** Prefers the photo, then the preset painting, then initials; with none, draws the placeholder for a collection. */
export function ProfileAvatar({
  name,
  photoUrl,
  avatar,
  size = 40,
}: {
  name?: string;
  photoUrl?: string;
  avatar?: AvatarId;
  size?: number;
}) {
  const [failed, setFailed] = useState<string>();
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
          label={name ? `${name} profile photo` : "Profile photo"}
          contentFit="cover"
          onError={() => setFailed(photoUrl)}
          style={{ width: size, height: size }}
        />
      ) : avatar ? (
        <Image
          source={AVATAR_IMAGES[avatar]}
          cachePolicy="memory"
          accessible={false}
          style={{ width: size, height: size }}
        />
      ) : name ? (
        <Text
          allowFontScaling={false}
          style={{
            fontSize: size * 0.3,
            fontWeight: "600",
            letterSpacing: 0.4,
            color: Gallery.ink,
          }}
        >
          {initials(name)}
        </Text>
      ) : (
        <Image
          source="sf:person.fill"
          tintColor={Gallery.ink}
          style={{ width: size * 0.44, height: size * 0.44 }}
          accessible={false}
        />
      )}
    </View>
  );
}
