import { StyleSheet, View } from "react-native";

import { GalleryIconButton } from "@/components/collection/gallery-icon-button";
import { Gallery } from "@/constants/theme";
import { toggleReminder, toggleWantToSee, usePlans } from "@/lib/explore/plans";
import type { Exhibition } from "@/lib/explore/types";

export function WantToSeeButton({ exhibition }: { exhibition: Exhibition }) {
  const saved = usePlans().wantToSee.has(exhibition.id);
  return (
    <GalleryIconButton
      icon={saved ? "bookmark.fill" : "bookmark"}
      label={saved ? `Remove ${exhibition.title} from Want to see` : `Want to see ${exhibition.title}`}
      tone={saved ? "accent" : "muted"}
      onPress={() => toggleWantToSee(exhibition.id)}
    />
  );
}

/** For a show that has not opened: a reminder on its opening day. */
export function ReminderButton({ exhibition, overlay = false }: { exhibition: Exhibition; overlay?: boolean }) {
  const on = usePlans().reminders.has(exhibition.id);
  const button = (
    <GalleryIconButton
      icon={on ? "bell.fill" : "bell"}
      label={on ? `Turn off the reminder for ${exhibition.title}` : `Remind me when ${exhibition.title} opens`}
      tone={on ? "accent" : "ink"}
      size={18}
      onPress={() => toggleReminder(exhibition.id)}
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
