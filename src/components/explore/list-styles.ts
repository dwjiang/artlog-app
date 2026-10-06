import { StyleSheet } from "react-native";

import { Gallery, Spacing, Typography } from "@/constants/theme";

export const listStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Gallery.paper },
  content: { paddingBottom: Spacing.five },
  empty: {
    ...Typography.secondary,
    color: Gallery.muted,
    paddingHorizontal: Spacing.content,
    paddingTop: Spacing.three,
  },
});
