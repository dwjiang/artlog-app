import { type ComponentPropsWithRef, createContext, type ReactNode, use } from "react";
import { StyleSheet, Text, type TextStyle, useWindowDimensions } from "react-native";

import { DisplayMaxFontSize, Fonts, Gallery, type TextRole, type ThemeColor, Typography } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

type TextType = "default" | "title" | "small" | "smallBold" | "subtitle" | "link" | "linkPrimary" | "code";
export type ThemedTextProps = ComponentPropsWithRef<typeof Text> & {
  variant?: TextRole;
  type?: TextType;
  themeColor?: ThemeColor;
};

const typeStyles: Record<TextType, TextStyle> = {
  default: Typography.body,
  title: Typography.display,
  small: Typography.metadata,
  smallBold: { ...Typography.metadata, fontWeight: "600" },
  subtitle: Typography.section,
  link: { ...Typography.secondary, fontWeight: "500", color: Gallery.accent },
  linkPrimary: {
    ...Typography.secondary,
    fontWeight: "500",
    color: Gallery.accent,
  },
  code: { ...Typography.metadata, fontFamily: Fonts.mono },
};

const TextContext = createContext(false);
const TextScaleLimitContext = createContext(Infinity);

/** Stops Dynamic Type for all text inside at `max`, as SwiftUI's `dynamicTypeSize` does for a container. */
export function TextScaleLimit({ max, children }: { max: number; children: ReactNode }) {
  const outer = use(TextScaleLimitContext);
  return <TextScaleLimitContext value={Math.min(outer, max)}>{children}</TextScaleLimitContext>;
}

/** The Dynamic Type scale text reaches here, so an icon beside it can grow with it. */
export function useTextScale(max = Infinity) {
  const { fontScale } = useWindowDimensions();
  return Math.min(fontScale, use(TextScaleLimitContext), max >= 1 ? max : Infinity);
}

export function ThemedText({ style, variant, type, themeColor, maxFontSizeMultiplier, ...rest }: ThemedTextProps) {
  const theme = useTheme();
  const { fontScale } = useWindowDimensions();
  const nested = use(TextContext);
  const limit = use(TextScaleLimitContext);

  // A caller's own fontSize keeps its natural line height; the body role is only a fallback for unsized text.
  const sized = StyleSheet.flatten(style)?.fontSize !== undefined;
  const textStyle = StyleSheet.flatten([
    !nested && { color: theme.text },
    variant ? Typography[variant] : type ? typeStyles[type] : !nested && !sized && Typography.body,
    themeColor && { color: theme[themeColor] },
    style,
  ]);
  const { fontFamily, fontSize }: TextStyle = textStyle ?? {};
  const displayLimit = fontFamily === Fonts.display && fontSize ? Math.max(1, DisplayMaxFontSize / fontSize) : Infinity;
  // Only a multiplier of 1 or more caps text; 0 lifts an inherited cap and undefined keeps it.
  const ownLimit = maxFontSizeMultiplier && maxFontSizeMultiplier >= 1 ? maxFontSizeMultiplier : Infinity;
  const max = Math.min(ownLimit, limit, displayLimit);

  // iOS can retain stale text measurements after a live Dynamic Type change.
  return (
    <TextContext value={true}>
      <Text
        key={fontScale}
        style={textStyle}
        maxFontSizeMultiplier={Number.isFinite(max) ? max : maxFontSizeMultiplier}
        {...rest}
      />
    </TextContext>
  );
}
