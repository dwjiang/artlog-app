import { useRouter, type Href } from "expo-router";
import { useState } from "react";
import { StyleSheet } from "react-native";

import { ThemedText as Text, type ThemedTextProps } from "@/components/themed-text";
import { Gallery } from "@/constants/theme";
import type { Mention } from "@/lib/social/types";
import { richTextSegments } from "@/shared/social/rich-text";

export const tagHref = (tag: string) => ({ pathname: "/tag/[tag]", params: { tag } }) as const;
export const profileHref = (profileId: string) =>
  ({ pathname: "/profile/[profileId]", params: { profileId } }) as const;

/**
 * Text that opens `href`, on its own or nested inside another text. `onOpen` runs before the page opens, for hosts such
 * as a native sheet that must close first.
 */
export function TextLink({ href, onOpen, style, ...props }: ThemedTextProps & { href: Href; onOpen?: () => void }) {
  const router = useRouter();
  const [pressed, setPressed] = useState(false);
  return (
    <Text
      accessibilityRole="link"
      suppressHighlighting
      {...props}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      // A long press selects text to copy, so releasing it must not open the link.
      onLongPress={() => setPressed(false)}
      onPress={() => {
        onOpen?.();
        router.push(href);
      }}
      style={[style, pressed && styles.pressed]}
    />
  );
}

/**
 * Text whose #tags open their tag page and whose @handles open the profile `mentions` resolves them to; a handle the
 * list leaves out reads as plain text. Works on its own or nested inside another text. `onOpenLink` runs before a page
 * opens, for hosts such as a native sheet that must close first.
 */
export function TaggedText({
  children,
  mentions = [],
  onOpenLink,
  ...props
}: Omit<ThemedTextProps, "children"> & {
  children: string;
  mentions?: readonly Mention[];
  onOpenLink?: () => void;
}) {
  return (
    <Text {...props}>
      {richTextSegments(children).map(({ text, tag, mention }, index) => {
        const profileId = mention && mentions.find((row) => row.username === mention)?.profileId;
        const href = tag ? tagHref(tag) : profileId ? profileHref(profileId) : undefined;
        return href ? (
          <TextLink key={index} href={href} onOpen={onOpenLink} style={styles.link}>
            {text}
          </TextLink>
        ) : (
          text
        );
      })}
    </Text>
  );
}

const styles = StyleSheet.create({
  link: { color: Gallery.accent },
  pressed: { backgroundColor: Gallery.highlight },
});
