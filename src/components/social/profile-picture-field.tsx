import { useState, type ComponentProps } from "react";
import { View } from "react-native";

import { GalleryButton } from "@/components/collection/gallery-button";
import type { ProfilePicture } from "@/lib/social/profile-picture";

import { ProfileAvatar } from "./profile-avatar";
import { ProfilePicturePicker } from "./profile-picture-picker";

/** Edit profile's picture: the avatar as it will be saved, over the button that opens the picker. */
export function ProfilePictureField({
  name,
  shown,
  disabled,
  onChoose,
}: {
  name?: string;
  shown: ComponentProps<typeof ProfilePicturePicker>["shown"];
  disabled: boolean;
  onChoose: (picture: ProfilePicture) => void;
}) {
  const [picking, setPicking] = useState(false);
  return (
    <>
      <View style={{ alignItems: "center", gap: 8 }}>
        <ProfileAvatar name={name} photoUrl={shown.photoUrl} avatar={shown.avatar} size={80} />
        <GalleryButton label="Change picture" disabled={disabled} onPress={() => setPicking(true)} />
      </View>
      <ProfilePicturePicker
        visible={picking}
        name={name}
        shown={shown}
        onCancel={() => setPicking(false)}
        onSave={(next) => {
          onChoose(next);
          setPicking(false);
        }}
      />
    </>
  );
}
