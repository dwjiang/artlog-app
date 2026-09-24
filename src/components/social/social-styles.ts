import { StyleSheet } from "react-native";

import { Gallery, Spacing, Typography } from "@/constants/theme";

export const socialStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Gallery.paper },
  content: { paddingBottom: Spacing.four, flexGrow: 1 },
  section: {
    paddingHorizontal: Spacing.content,
    paddingVertical: Spacing.four,
    gap: Spacing.three,
  },
  gate: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingBottom: Spacing.four,
  },
  state: {
    paddingHorizontal: Spacing.content,
    paddingVertical: Spacing.five,
    gap: Spacing.three,
    alignItems: "center",
    width: "100%",
  },
  title: { ...Typography.section, color: Gallery.ink, textAlign: "center" },
  body: {
    ...Typography.secondary,
    color: Gallery.muted,
    textAlign: "center",
    maxWidth: 420,
  },
  caption: { ...Typography.metadata, color: Gallery.muted },
  footer: {
    paddingHorizontal: Spacing.content,
    paddingVertical: Spacing.four,
    gap: Spacing.two,
    alignItems: "center",
  },
});
