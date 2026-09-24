import { StyleSheet, View } from "react-native";
import { Gallery, Spacing } from "@/constants/theme";
import { ThemedText } from "./themed-text";

export function HighlightHeading({ children, small = false }: { children: string; small?: boolean }) {
  return (
    <View style={styles.highlight}>
      <ThemedText
        variant="section"
        accessibilityRole="header"
        style={small ? { fontSize: 16, lineHeight: 21 } : { fontSize: 18, lineHeight: 24 }}
      >
        {children}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  highlight: {
    alignSelf: "flex-start",
    backgroundColor: Gallery.highlight,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
});
