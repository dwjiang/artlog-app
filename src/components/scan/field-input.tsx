import { Host, Icon, Row, TextInput } from "@expo/ui";
import { useNativeState } from "@expo/ui/swift-ui";
import {
  accessibilityHidden,
  accessibilityLabel,
  background,
  clipShape,
  font,
  frame,
  padding,
  strokeBorder,
} from "@expo/ui/swift-ui/modifiers";
import { useEffect, useImperativeHandle, useState, type ComponentProps, type Ref } from "react";
import { StyleSheet, type StyleProp, type ViewStyle } from "react-native";

import { Gallery, Radius, Spacing } from "@/constants/theme";

export type FieldInputRef = { getText: () => string };

export type FieldInputProps = {
  ref?: Ref<FieldInputRef>;
  label: string;
  placeholder?: string;
  defaultValue: string;
  editable: boolean;
  autoCapitalize: "none" | "words" | "sentences";
  onChangeText: (value: string) => void;
  onBlur?: () => void;
  maxLength?: number;
  numberOfLines?: number;
  variant?: "outlined" | "filled";
  icon?: ComponentProps<typeof Icon>["name"];
  style?: StyleProp<ViewStyle>;
};

function limitTextLength(value: string, maxLength?: number) {
  "worklet";
  if (maxLength === undefined || value.length <= maxLength) return value;
  const last = value.charCodeAt(maxLength - 1);
  const end = last >= 0xd800 && last <= 0xdbff ? maxLength - 1 : maxLength;
  return value.slice(0, end);
}

export function FieldInput({
  ref,
  label,
  placeholder = label,
  defaultValue,
  editable,
  autoCapitalize,
  onChangeText,
  onBlur,
  maxLength,
  numberOfLines,
  variant = "outlined",
  icon,
  style,
}: FieldInputProps) {
  const [focused, setFocused] = useState(false);
  const text = useNativeState(limitTextLength(defaultValue, maxLength));
  useEffect(() => {
    if (maxLength === undefined) return;
    // SwiftUI counts graphemes; persistence counts UTF-16 units. Clamp on the UI thread before JS receives the edit.
    // oxlint-disable-next-line react/immutability -- Expo's native state listener uses a mutable setter.
    text.onChange = (value) => {
      "worklet";
      const limited = limitTextLength(value, maxLength);
      if (limited !== value) text.set(limited);
    };
    return () => {
      text.onChange = null;
    };
  }, [text, maxLength]);
  useImperativeHandle(ref, () => ({ getText: () => limitTextLength(text.get(), maxLength) }), [text, maxLength]);
  const filled = variant === "filled";
  const hasRow = filled || !!icon;
  // Inset native strokes preserve rounded corners without shifting the Host's initial layout.
  const boxModifiers = [
    padding(filled ? { all: Spacing.three } : { horizontal: 11, vertical: 10 }),
    background(filled ? Gallery.fill : Gallery.surface),
    strokeBorder({
      color: focused ? Gallery.accent : filled ? "transparent" : Gallery.controlBorder,
      shape: "roundedRectangle",
      cornerRadius: Radius.input,
      style: { lineWidth: 1 },
    }),
    clipShape("roundedRectangle", Radius.input),
  ];
  const input = (
    <TextInput
      value={text}
      placeholder={placeholder}
      editable={editable}
      autoCapitalize={autoCapitalize}
      autoCorrect={false}
      multiline
      maxLength={maxLength}
      numberOfLines={numberOfLines}
      selectionColor={Gallery.accent}
      placeholderTextColor={Gallery.muted}
      textStyle={{ color: Gallery.ink }}
      modifiers={[
        font({ textStyle: "body" }),
        accessibilityLabel(label),
        ...(hasRow ? [frame({ maxWidth: Infinity, alignment: "topLeading" })] : boxModifiers),
      ]}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        if (onBlur) {
          onChangeText(limitTextLength(text.get(), maxLength));
          onBlur();
        }
      }}
      onChangeText={(value) => onChangeText(limitTextLength(value, maxLength))}
    />
  );
  return (
    <Host matchContents={{ vertical: true }} colorScheme="light" style={[styles.host, style]}>
      {hasRow ? (
        <Row alignment="start" spacing={Spacing.compact} modifiers={boxModifiers}>
          {icon && (
            <Icon
              name={icon}
              size={19}
              color={Gallery.muted}
              modifiers={[padding({ top: 2 }), accessibilityHidden(true)]}
            />
          )}
          {input}
        </Row>
      ) : (
        input
      )}
    </Host>
  );
}

const styles = StyleSheet.create({
  host: { width: "100%" },
});
