import { useEffect, useState } from "react";
import { Keyboard, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GalleryButton } from "@/components/collection/gallery-button";
import { Gallery, PinnedFooterBorder, Radius } from "@/constants/theme";

/** The end-of-visit form's Save & end visit; it steps aside while the keyboard covers it. */
export function VisitActionBar({
  saving,
  disabled,
  onSave,
}: {
  saving: boolean;
  disabled: boolean;
  onSave: () => void;
}) {
  const { bottom, left, right } = useSafeAreaInsets();
  const [keyboardVisible, setKeyboardVisible] = useState(() => Keyboard.isVisible());
  useEffect(() => {
    const show = Keyboard.addListener("keyboardWillShow", () => setKeyboardVisible(true));
    const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboardVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  if (keyboardVisible) return null;
  return (
    <View
      style={{
        paddingLeft: 20 + left,
        paddingRight: 20 + right,
        paddingTop: 12,
        paddingBottom: Math.max(bottom, 12),
        backgroundColor: Gallery.groupedBackground,
        ...PinnedFooterBorder,
      }}
    >
      <GalleryButton
        label="Save & end visit"
        busy={saving}
        busyLabel="Saving…"
        variant="filled"
        fullWidth
        cornerRadius={Radius.sheet}
        disabled={disabled}
        onPress={onSave}
      />
    </View>
  );
}
