import { useState } from "react";
import { View } from "react-native";

import { ThemedText as Text } from "@/components/themed-text";
import { Gallery } from "@/constants/theme";

import { GalleryButton } from "./gallery-button";
import { WallPhotoPicker } from "./wall-photo-picker";
import { WallSheet } from "./wall-sheet";

export function WallPhotoSheet({
  savedId,
  title,
  photoId,
  duplicate,
  onConfirm,
  onDismiss,
}: {
  savedId: string;
  title: string;
  photoId?: string;
  duplicate: boolean;
  onConfirm: (photoId: string) => void;
  onDismiss: () => void;
}) {
  const [selected, setSelected] = useState(photoId);
  return (
    <WallSheet
      title={duplicate ? "Hang another photo" : "Choose wall photo"}
      onDismiss={onDismiss}
      dismissLabel="Cancel"
      footer={
        <View style={{ padding: 20 }}>
          <GalleryButton
            label={duplicate ? "Hang selected photo" : "Use selected photo"}
            disabled={!selected}
            variant="filled"
            fullWidth
            onPress={() => {
              if (selected) onConfirm(selected);
            }}
          />
        </View>
      }
    >
      <View style={{ padding: 20, gap: 16 }}>
        <Text style={{ fontSize: 19, color: Gallery.ink }}>{title}</Text>
        <Text style={{ fontSize: 13, color: Gallery.muted }}>
          {duplicate ? "Adds a second placement of this artwork." : "Only this placement’s image will change."}
        </Text>
        <WallPhotoPicker savedId={savedId} selectedId={selected} onSelect={setSelected} />
        <Text style={{ fontSize: 13, lineHeight: 18, color: Gallery.muted }}>
          This selected image will be visible on your public wall. Other photos keep their existing sharing choices.
          Visit dates aren’t shown on the wall.
        </Text>
      </View>
    </WallSheet>
  );
}
