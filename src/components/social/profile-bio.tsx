import { useState } from "react";
import { View } from "react-native";

import { MotionPressable } from "@/components/motion-pressable";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery } from "@/constants/theme";
import type { Mention } from "@/lib/social/types";

import { TaggedText } from "./tagged-text";

export function ProfileBio({ text, mentions }: { text?: string; mentions?: readonly Mention[] }) {
  const [expanded, setExpanded] = useState(false);
  const [long, setLong] = useState(false);
  if (!text) return null;
  return (
    <View style={{ gap: 4, alignSelf: "stretch", alignItems: "center" }}>
      <Text
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          opacity: 0,
          fontSize: 16,
          lineHeight: 24,
          textAlign: "center",
        }}
        accessibilityElementsHidden
        onTextLayout={(event) => setLong(event.nativeEvent.lines.length > 2)}
      >
        {text}
      </Text>
      <TaggedText
        selectable
        mentions={mentions}
        numberOfLines={expanded ? undefined : 2}
        style={{ fontSize: 16, lineHeight: 24, color: Gallery.ink, textAlign: "center" }}
      >
        {text}
      </TaggedText>
      {long && (
        <MotionPressable
          style={{ minHeight: 44, justifyContent: "center" }}
          accessibilityRole="button"
          onPress={() => setExpanded(!expanded)}
        >
          <Text style={{ color: Gallery.accent, fontSize: 13, paddingVertical: 5 }}>
            {expanded ? "Show less" : "Read more"}
          </Text>
        </MotionPressable>
      )}
    </View>
  );
}
