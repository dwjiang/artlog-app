import { useRouter } from "expo-router";
import { ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GalleryButton } from "@/components/collection/gallery-button";
import { ArtworkCollage } from "@/components/guest/artwork-preview";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, Spacing, Typography } from "@/constants/theme";
import { signInRoute } from "@/lib/account/sign-in-context";

export function WelcomeScreen() {
  const router = useRouter();
  const { top, bottom } = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  return (
    <ScrollView
      style={styles.root}
      contentInsetAdjustmentBehavior="never"
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: top + Spacing.three,
          paddingBottom: Math.max(24, bottom),
        },
      ]}
    >
      <Text
        accessibilityRole="header"
        accessibilityLabel="Welcome to Artlog"
        variant={fontScale > 1.4 ? "display" : "wordmark"}
      >
        Artlog
      </Text>
      <View style={styles.brand}>
        <ArtworkCollage welcome />
        <View style={styles.copy}>
          <Text style={fontScale > 1.3 ? Typography.display : styles.tagline}>
            {fontScale > 1.3 ? "Remember the art that stays with you." : "Remember\nthe art that\nstays with you."}
          </Text>
          <Text themeColor="textSecondary">Scan artworks and save your museum visits.</Text>
        </View>
      </View>
      <View style={styles.actions}>
        <GalleryButton label="Get started" fullWidth variant="filled" onPress={() => router.back()} />
        <GalleryButton
          label="I already have an account"
          fullWidth
          onPress={() => router.replace(signInRoute("account"))}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Gallery.paper },
  content: {
    flexGrow: 1,
    paddingHorizontal: Spacing.content,
    gap: Spacing.three,
    maxWidth: 520,
    width: "100%",
    alignSelf: "center",
  },
  brand: { flexGrow: 1, justifyContent: "center", gap: Spacing.three },
  copy: { gap: Spacing.compact },
  tagline: {
    ...Typography.display,
    fontSize: 44,
    lineHeight: 50,
    color: Gallery.ink,
  },
  actions: { gap: Spacing.two, paddingTop: Spacing.two },
});
