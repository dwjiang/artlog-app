import { Image } from "expo-image";
import { useState, type Ref } from "react";
import { StyleSheet, TextInput, View, type StyleProp, type ViewStyle } from "react-native";

import { MotionPressable } from "@/components/motion-pressable";
import { ThemedText } from "@/components/themed-text";
import { Gallery, Radius, Spacing, Typography } from "@/constants/theme";

export function SearchField({
  value,
  label,
  placeholder = label,
  showLabel = true,
  filled = false,
  onChange,
  onClear,
  inputRef,
  editable = true,
  maxLength,
  style,
}: {
  inputRef?: Ref<TextInput>;
  value: string;
  label: string;
  placeholder?: string;
  showLabel?: boolean;
  filled?: boolean;
  onChange: (value: string) => void;
  onClear: () => void;
  editable?: boolean;
  maxLength?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={[{ gap: Spacing.two }, style]}>
      {showLabel && <ThemedText variant="metadata">{label}</ThemedText>}
      <View
        style={[
          styles.field,
          {
            borderColor: focused ? Gallery.accent : filled ? "transparent" : Gallery.controlBorder,
            backgroundColor: filled ? Gallery.fill : Gallery.surface,
          },
        ]}
      >
        <Image
          source="sf:magnifyingglass"
          tintColor={Gallery.muted}
          style={{ width: 17, height: 17 }}
          accessible={false}
        />
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={onChange}
          editable={editable}
          maxLength={maxLength}
          placeholder={placeholder}
          accessibilityLabel={label}
          autoCapitalize="none"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          keyboardAppearance="light"
          selectionColor={Gallery.accent}
          placeholderTextColor={Gallery.muted}
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="never"
          style={styles.input}
        />
        {!!value && (
          <MotionPressable
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            accessibilityState={{ disabled: !editable }}
            disabled={!editable}
            onPress={onClear}
            style={styles.clear}
          >
            <Image
              source="sf:xmark.circle.fill"
              tintColor={Gallery.accent}
              style={{ width: 19, height: 19 }}
              accessible={false}
            />
          </MotionPressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingLeft: Spacing.compact,
    paddingRight: Spacing.one,
    borderRadius: Radius.input,
    borderCurve: "continuous",
    borderWidth: 1,
    backgroundColor: Gallery.surface,
  },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    paddingVertical: Spacing.two,
    ...Typography.body,
    color: Gallery.ink,
  },
  clear: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
});
