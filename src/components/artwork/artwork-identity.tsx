import { Image } from "expo-image";
import { useState, type ComponentRef, type Ref } from "react";
import { StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Gallery, Spacing } from "@/constants/theme";

/** An artwork page's title, artist and date, then its medium and museum, as the scan card and catalog page show them. */
export function ArtworkIdentity({
  title,
  artist,
  date,
  medium,
  institution,
  onOpenArtist,
  headingRef,
  onHeadingLayout,
}: {
  title: string;
  artist?: string;
  date?: string | null;
  medium?: string;
  institution?: string;
  /** Makes the artist's name a link. */
  onOpenArtist?: () => void;
  headingRef?: Ref<ComponentRef<typeof ThemedText>>;
  onHeadingLayout?: () => void;
}) {
  const [pressed, setPressed] = useState(false);
  return (
    <View style={styles.identity}>
      <ThemedText type="title" accessibilityRole="header" ref={headingRef} onLayout={onHeadingLayout}>
        {title}
      </ThemedText>
      {(!!artist || !!date) && (
        <ThemedText style={styles.attribution}>
          {artist && onOpenArtist ? (
            <ThemedText
              accessibilityRole="link"
              suppressHighlighting
              onPressIn={() => setPressed(true)}
              onPressOut={() => setPressed(false)}
              onPress={onOpenArtist}
              style={[styles.attribution, styles.link, pressed && styles.pressed]}
            >
              {artist}
            </ThemedText>
          ) : (
            artist
          )}
          {!!artist && !!date && " · "}
          {date}
        </ThemedText>
      )}
      {!!medium && <Metadata icon="sf:paintbrush.pointed" text={medium} />}
      {!!institution && <Metadata icon="sf:building.columns" text={institution} />}
    </View>
  );
}

function Metadata({ icon, text }: { icon: string; text: string }) {
  return (
    <View style={styles.metadata}>
      <Image source={icon} tintColor={Gallery.muted} style={styles.metadataIcon} accessible={false} />
      <ThemedText variant="metadata" themeColor="textSecondary" style={{ flexShrink: 1 }}>
        {text}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  identity: { gap: Spacing.two },
  attribution: { fontSize: 18, lineHeight: 26 },
  link: { color: Gallery.accent },
  pressed: { backgroundColor: Gallery.highlight },
  metadata: { flexDirection: "row", alignItems: "flex-start", gap: 4 },
  // Centers the icon on the first text line so it stays put when a long name wraps.
  metadataIcon: { width: 12, height: 12, marginTop: 3 },
});
