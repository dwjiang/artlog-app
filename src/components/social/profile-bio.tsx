import { useState } from "react";
import { Pressable, View } from "react-native";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery } from "@/constants/theme";
export function ProfileBio({ text }: { text?: string }) {
  const [expanded, setExpanded] = useState(false),
    [long, setLong] = useState(false);
  if (!text) return null;
  return (
    <View style={{ gap: 4 }}>
      <Text
        style={{ position: "absolute", opacity: 0, fontSize: 16, lineHeight: 24 }}
        accessibilityElementsHidden
        onTextLayout={(event) => setLong(event.nativeEvent.lines.length > 2)}
      >
        {text}
      </Text>
      <Text
        selectable
        numberOfLines={expanded ? undefined : 2}
        style={{ fontSize: 16, lineHeight: 24, color: Gallery.ink }}
      >
        {text}
      </Text>
      {long && (
        <Pressable
          style={{ minHeight: 44, justifyContent: "center" }}
          accessibilityRole="button"
          onPress={() => setExpanded(!expanded)}
        >
          <Text style={{ color: Gallery.accent, fontSize: 13, paddingVertical: 5 }}>
            {expanded ? "Show less" : "Read more"}
          </Text>
        </Pressable>
      )}
    </View>
  );
}
