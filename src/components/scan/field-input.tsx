import { Host, TextInput } from "@expo/ui";
import {
  accessibilityLabel,
  background,
  clipShape,
  font,
  padding,
  strokeBorder,
} from "@expo/ui/swift-ui/modifiers";
import { useState } from "react";
import { StyleSheet, type StyleProp, type ViewStyle } from "react-native";

import { Gallery, Radius } from "@/constants/theme";

export type FieldInputProps = {
  label: string;
  defaultValue: string;
  editable: boolean;
  autoCapitalize: "none" | "words";
  onChangeText: (value: string) => void;
  style?: StyleProp<ViewStyle>;
};

/** A multiline native text field in a bordered box that highlights while focused. */
export function FieldInput({
  label,
  defaultValue,
  editable,
  autoCapitalize,
  onChangeText,
  style,
}: FieldInputProps) {
  const [focused, setFocused] = useState(false);
  return (
    <Host matchContents={{ vertical: true }} colorScheme="light" style={[styles.host, style]}>
      <TextInput
        defaultValue={defaultValue}
        placeholder={label}
        editable={editable}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        multiline
        selectionColor={Gallery.accent}
        placeholderTextColor={Gallery.muted}
        textStyle={{ color: Gallery.ink }}
        // Style borders are a square stroke clipped by the radius, which notches the corners, so the box is built from
        // modifiers: the inset strokeBorder survives the clip that rounds the fill. Keep the background shapeless and
        // the Host unbordered; both shift the field up by half its height on first mount.
        modifiers={[
          font({ textStyle: "body" }),
          accessibilityLabel(label),
          padding({ horizontal: 11, vertical: 10 }),
          background(Gallery.surface),
          strokeBorder({
            color: focused ? Gallery.accent : Gallery.controlBorder,
            shape: "roundedRectangle",
            cornerRadius: Radius.input,
            style: { lineWidth: 1 },
          }),
          clipShape("roundedRectangle", Radius.input),
        ]}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChangeText={onChangeText}
      />
    </Host>
  );
}

const styles = StyleSheet.create({
  host: { width: "100%" },
});
