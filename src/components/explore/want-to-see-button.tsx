import { StyleSheet, View } from "react-native";

import { GalleryIconButton } from "@/components/collection/gallery-icon-button";
import { Gallery } from "@/constants/theme";
import type { Exhibition } from "@/lib/explore/types";
import { useWantToSee } from "@/lib/explore/want-to-see";

/**
 * Saves a show to Want to see, which also reminds about it when it opens and before it closes. A `closed` show's
 * bookmark stays gray, so it recedes with the rest of its row.
 */
export function WantToSeeButton({
  exhibition,
  overlay = false,
  closed = false,
}: {
  exhibition: Exhibition;
  overlay?: boolean;
  closed?: boolean;
}) {
  const { saved, ready, toggle } = useWantToSee();
  const on = saved.has(exhibition.id);
  const button = (
    <GalleryIconButton
      icon={on ? "bookmark.fill" : "bookmark"}
      label={on ? `Remove ${exhibition.title} from Want to see` : `Want to see ${exhibition.title}`}
      tone={on && !closed ? "accent" : overlay ? "ink" : "muted"}
      size={overlay ? 18 : undefined}
      disabled={!ready}
      onPress={() => toggle(exhibition)}
    />
  );
  return overlay ? <View style={styles.overlay}>{button}</View> : button;
}

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255, 255, 255, 0.92)",
    shadowColor: Gallery.ink,
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
});
