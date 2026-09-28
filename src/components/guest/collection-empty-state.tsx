import { router } from "expo-router";
import { StyleSheet, View, useWindowDimensions } from "react-native";

import { GalleryButton } from "@/components/collection/gallery-button";
import { ThemedText as Text } from "@/components/themed-text";
import { Spacing, Typography } from "@/constants/theme";

import { ArtworkCollage } from "./artwork-preview";
import { VisitKeepsake } from "./visit-keepsake";

export function CollectionEmptyState({ kind }: { kind: "artworks" | "visits" }) {
  const visits = kind === "visits";
  const { fontScale } = useWindowDimensions();
  return (
    <View style={styles.root}>
      {visits ? <VisitKeepsake /> : <ArtworkCollage />}
      <View style={styles.copy}>
        <Text
          variant="display"
          accessibilityRole="header"
          style={[styles.title, fontScale > 1.3 && { ...Typography.display, maxWidth: "100%" }]}
        >
          {visits ? "No visits yet." : "No saved artworks yet."}
        </Text>
        <Text themeColor="textSecondary">
          {visits
            ? "Add a museum visit to record its date, artworks, and notes."
            : "Scan an artwork to add it to your collection."}
        </Text>
      </View>
      <GalleryButton
        label={visits ? "Add visit" : "Scan artwork"}
        variant="filled"
        fullWidth
        onPress={() => (visits ? router.push("/visit-create") : router.navigate("/scan"))}
      />
      {visits && (
        <Text variant="metadata" themeColor="textSecondary">
          Your visits stay private until you share them.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    paddingHorizontal: Spacing.content,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.four,
    gap: Spacing.compact,
    width: "100%",
    maxWidth: 520,
    alignSelf: "center",
  },
  title: { fontSize: 36, lineHeight: 42, maxWidth: 320 },
  copy: { gap: Spacing.two },
});
