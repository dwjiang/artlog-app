import { type ComponentPropsWithRef, createContext, use } from "react";
import { StyleSheet, Text, type TextStyle, useWindowDimensions } from "react-native";

import { Fonts, Gallery, type TextRole, type ThemeColor, Typography } from "@/constants/theme";
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

// iOS keeps a line's full descent when lineHeight is tighter than the font's own and clips glyphs above the frame.
// Anton's accented capitals rise 2254 units over a 674-unit descent (2048 per em), so tight lines need top padding.
const ANTON_GLYPH_HEIGHT = (2254 + 674) / 2048;

function displayPaddingTop({ fontSize, lineHeight, paddingTop, paddingVertical, padding }: TextStyle, scale: number) {
  const callerPadding = paddingTop ?? paddingVertical ?? padding ?? 0;
  if (fontSize === undefined || lineHeight === undefined || typeof callerPadding !== "number") return callerPadding;
  return Math.max(callerPadding, Math.ceil((fontSize * ANTON_GLYPH_HEIGHT - lineHeight) * scale));
}

export function ThemedText({ style, variant, type, themeColor, ...rest }: ThemedTextProps) {
  const theme = useTheme();
  const { fontScale } = useWindowDimensions();
  const nested = use(TextContext);

  // A caller's own fontSize keeps its natural line height; the body role is only a fallback for unsized text.
  const sized = StyleSheet.flatten(style)?.fontSize !== undefined;
  const textStyle: TextStyle = StyleSheet.flatten([
    !nested && { color: theme.text },
    variant ? Typography[variant] : type ? typeStyles[type] : !nested && !sized && Typography.body,
    themeColor && { color: theme[themeColor] },
    style,
  ]);

  const display = textStyle.fontFamily === Fonts.display;
  const scale = rest.allowFontScaling === false ? 1 : fontScale;

  // iOS can retain stale text measurements after a live Dynamic Type change.
  return (
    <TextContext value={true}>
      <Text
        key={fontScale}
        style={[
          textStyle,
          display && { fontWeight: "400" },
          display && !nested && { paddingTop: displayPaddingTop(textStyle, scale) },
        ]}
        {...rest}
      />
    </TextContext>
  );
}
