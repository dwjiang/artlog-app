import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { Fonts, Gallery, Spacing } from "@/constants/theme";

const TEXT_TOP = 2;
const TITLE_LINE = 22;
const TARGET = 44;
const GLYPH = 21;

/** A sideways card's text under its picture, with a title that leaves room for the bookmark beside it. */
export const cardText = StyleSheet.create({
  text: { paddingTop: TEXT_TOP },
  title: {
    fontFamily: Fonts.display,
    fontSize: 17,
    lineHeight: TITLE_LINE,
    letterSpacing: -0.2,
    color: Gallery.ink,
    paddingRight: GLYPH + Spacing.two,
  },
});

/**
 * Holds the bookmark of a card that stacks its picture, `imageHeight` tall, a `Spacing.two` gap and its text: the target
 * centers on the title's first line, with the glyph flush with the picture's right edge.
 */
export function CardBookmark({ imageHeight, children }: { imageHeight: number; children: ReactNode }) {
  return (
    <View style={[styles.slot, { top: imageHeight + Spacing.two + TEXT_TOP + (TITLE_LINE - TARGET) / 2 }]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({ slot: { position: "absolute", right: -(TARGET - GLYPH) / 2 } });
