import { StyleSheet, View } from "react-native";

import { GalleryButton } from "@/components/collection/gallery-button";
import { SavedWorkImage } from "@/components/collection/saved-work-image";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, Radius, Spacing } from "@/constants/theme";
import { useLocalOwner } from "@/lib/account/owner-store";
import { sharedMuseum, useMakeVisit, useVisitlessSavesToday } from "@/lib/journal/visitless-saves";

const MAX_THUMBNAILS = 4;

/** Home's card for today's saves that missed a visit, with "Make it a visit" and "Not a visit". */
export function VisitlessSavesCard() {
  const owner = useLocalOwner();
  const { saves, dismiss } = useVisitlessSavesToday(owner);
  const { busy, make } = useMakeVisit();
  if (saves.length === 0) return null;
  const museum = sharedMuseum(saves)?.venueName;
  const title = `${saves.length} ${saves.length === 1 ? "artwork" : "artworks"} saved today`;
  const detail = museum ? `Not in a visit · near ${museum}` : "Not in a visit";
  return (
    <View style={styles.section}>
      <Text variant="section" accessibilityRole="header" style={styles.heading}>
        Today
      </Text>
      <View style={styles.card}>
        <View style={styles.thumbnails} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {saves.slice(0, MAX_THUMBNAILS).map((work) => (
            <SavedWorkImage key={work.localId} path={work.cropPath} title={work.title} style={styles.thumbnail} />
          ))}
        </View>
        <View accessible accessibilityLabel={`${title}. ${detail}`} style={styles.text}>
          <Text style={styles.title}>{title}</Text>
          <Text variant="secondary" themeColor="textSecondary">
            {detail}
          </Text>
        </View>
        <View style={styles.actions}>
          <GalleryButton
            label="Make it a visit"
            variant="filled"
            size="compact"
            busy={busy}
            busyLabel="Adding…"
            onPress={() => make(saves.map((work) => work.localId))}
          />
          <GalleryButton label="Not a visit" disabled={busy} onPress={dismiss} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { paddingHorizontal: Spacing.content, paddingTop: Spacing.two, paddingBottom: Spacing.two },
  heading: { paddingBottom: Spacing.two },
  card: { gap: Spacing.compact, padding: Spacing.three, borderRadius: Radius.card, backgroundColor: Gallery.fill },
  thumbnails: { flexDirection: "row", gap: Spacing.two },
  thumbnail: { width: 64, height: 64, borderRadius: Radius.thumbnail },
  text: { gap: Spacing.half },
  title: { fontSize: 17, lineHeight: 22, fontWeight: "600", color: Gallery.ink },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: Spacing.two },
});
