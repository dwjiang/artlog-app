import { useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet } from "react-native";

import { ThemedText as Text, type ThemedTextProps } from "@/components/themed-text";
import { Gallery } from "@/constants/theme";
import { hashtagSegments } from "@/shared/social/hashtags";

export const tagHref = (tag: string) => ({ pathname: "/tag/[tag]", params: { tag } }) as const;

/**
 * Text whose #tags open their tag page. Works on its own or nested inside another text. `onOpenTag` runs before the
 * page opens, for hosts such as a native sheet that must close first.
 */
export function TaggedText({
  children,
  onOpenTag,
  ...props
}: Omit<ThemedTextProps, "children"> & { children: string; onOpenTag?: () => void }) {
  const router = useRouter();
  const [pressed, setPressed] = useState<number>();
  return (
    <Text {...props}>
      {hashtagSegments(children).map(({ text, tag }, index) =>
        tag ? (
          <Text
            key={index}
            accessibilityRole="link"
            suppressHighlighting
            onPressIn={() => setPressed(index)}
            onPressOut={() => setPressed(undefined)}
            // A long press selects text to copy, so releasing it must not open the tag.
            onLongPress={() => setPressed(undefined)}
            onPress={() => {
              onOpenTag?.();
              router.push(tagHref(tag));
            }}
            style={[styles.tag, pressed === index && styles.pressed]}
          >
            {text}
          </Text>
        ) : (
          text
        ),
      )}
    </Text>
  );
}

const styles = StyleSheet.create({
  tag: { color: Gallery.accent },
  pressed: { backgroundColor: Gallery.highlight },
});
