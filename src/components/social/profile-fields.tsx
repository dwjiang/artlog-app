import { Image } from "expo-image";
import type { ComponentProps } from "react";
import { StyleSheet, TextInput, View } from "react-native";

import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, Radius, Spacing, Typography } from "@/constants/theme";
import { isUsernameProblem, usernameMessages, type UsernameCheck } from "@/lib/social/use-username-check";
import { LIMITS } from "@/shared/journal/limits";

import { useHashtagInput } from "./hashtag-input";

type InputProps = Omit<ComponentProps<typeof TextInput>, "style">;

export function ProfileField({ label, ...input }: InputProps & { label: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        keyboardAppearance="light"
        selectionColor={Gallery.accent}
        placeholderTextColor={Gallery.muted}
        returnKeyType={input.multiline ? "default" : "next"}
        {...input}
        style={[styles.input, styles.inputText, input.multiline && styles.multiline]}
      />
    </View>
  );
}

export function BioField({
  label,
  value,
  onChangeText,
  editable,
}: {
  label: string;
  value: string;
  onChangeText: (bio: string) => void;
  editable: boolean;
}) {
  const tagging = useHashtagInput(value, onChangeText, LIMITS.bio, editable);
  return (
    <View style={styles.field}>
      <ProfileField label={label} accessibilityLabel="Bio" multiline {...tagging.inputProps} />
      {tagging.suggestions}
    </View>
  );
}

export function UsernameField({
  value,
  onChangeText,
  check,
  hint,
  ...input
}: Omit<InputProps, "value" | "onChangeText"> & {
  value: string;
  onChangeText: (username: string) => void;
  check: UsernameCheck;
  /** Shown instead of the availability status, which then carries no error or success styling. */
  hint?: string;
}) {
  const problem = hint === undefined && isUsernameProblem(check);
  const available = hint === undefined && check === "available";
  return (
    <View style={styles.field}>
      <Text style={styles.label}>Username</Text>
      <View style={[styles.input, styles.usernameInput, problem && { borderColor: Gallery.destructive }]}>
        <Text style={styles.at}>@</Text>
        <TextInput
          accessibilityLabel="Username"
          value={value}
          onChangeText={(next) => onChangeText(next.toLowerCase().replaceAll(/\s+/g, ""))}
          placeholderTextColor={Gallery.muted}
          maxLength={LIMITS.usernameMax}
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="none"
          autoComplete="off"
          keyboardAppearance="light"
          selectionColor={Gallery.accent}
          returnKeyType="next"
          {...input}
          style={styles.usernameText}
        />
      </View>
      <View style={styles.status} accessibilityLiveRegion="polite">
        {available && <Image source="sf:checkmark.circle.fill" tintColor={Gallery.success} style={styles.statusIcon} />}
        <Text
          style={[
            styles.statusText,
            problem && { color: Gallery.destructive },
            available && { color: Gallery.success },
          ]}
        >
          {hint ?? usernameMessages[check]}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: Spacing.two },
  label: { ...Typography.secondary, color: Gallery.ink },
  input: {
    minHeight: 48,
    borderRadius: Radius.input,
    borderWidth: 1,
    borderColor: Gallery.controlBorder,
    backgroundColor: Gallery.surface,
  },
  inputText: { padding: 14, color: Gallery.ink, fontSize: 17 },
  multiline: { minHeight: 100, textAlignVertical: "top" },
  usernameInput: { flexDirection: "row", alignItems: "center", paddingLeft: 14 },
  at: { fontSize: 17, color: Gallery.muted },
  usernameText: { flex: 1, paddingVertical: 14, paddingLeft: 2, paddingRight: 14, color: Gallery.ink, fontSize: 17 },
  status: { flexDirection: "row", alignItems: "center", gap: Spacing.one },
  statusIcon: { width: 16, height: 16 },
  statusText: { flexShrink: 1, fontSize: 13, lineHeight: 18, color: Gallery.muted },
});
