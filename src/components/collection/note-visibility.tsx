import { ThemedText as Text } from "@/components/themed-text";
import { Host, Switch } from "@expo/ui";
import { View } from "react-native";
import { Gallery } from "@/constants/theme";

export function NoteVisibility({
  visible,
  disabled,
  onChange,
}: {
  visible: boolean;
  disabled?: boolean;
  onChange: (visible: boolean) => void;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Host matchContents={{ vertical: true }} colorScheme="light" seedColor={Gallery.accent}>
        <Switch
          label="Show note on public wall"
          value={visible}
          disabled={disabled}
          onValueChange={onChange}
        />
      </Host>
      <Text style={{ fontSize: 13, lineHeight: 18, color: Gallery.muted }}>
        Only this note becomes public. Editing a shared note makes it private until you share it
        again.
      </Text>
    </View>
  );
}
