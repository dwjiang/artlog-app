import { Platform, StyleSheet, Text, type TextProps } from 'react-native';

import { Fonts, Gallery, ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ThemedTextProps = TextProps & {
  type?: 'default' | 'title' | 'small' | 'smallBold' | 'subtitle' | 'link' | 'linkPrimary' | 'code';
  themeColor?: ThemeColor;
};

export function ThemedText({ style, type = 'default', themeColor, ...rest }: ThemedTextProps) {
  const theme = useTheme();

  return (
    <Text
      style={[
        { color: theme[themeColor ?? 'text'] },
        type === 'default' && styles.default,
        type === 'title' && styles.title,
        type === 'small' && styles.small,
        type === 'smallBold' && styles.smallBold,
        type === 'subtitle' && styles.subtitle,
        type === 'link' && styles.link,
        type === 'linkPrimary' && styles.linkPrimary,
        type === 'code' && styles.code,
        style,
      ]}
      {...rest}
    />
  );
}

// The gallery scale from DESIGN.md: 14/21 body, 12/18 supporting copy, semibold headings without display sizes.
const styles = StyleSheet.create({
  small: { fontSize: 12, lineHeight: 18 },
  smallBold: { fontSize: 12, lineHeight: 18, fontWeight: 600 },
  default: { fontSize: 14, lineHeight: 21 },
  title: { fontSize: 28, lineHeight: 33, fontWeight: 600, letterSpacing: -0.8 },
  subtitle: { fontSize: 22, lineHeight: 27, fontWeight: 600, letterSpacing: -0.4 },
  link: { fontSize: 13, lineHeight: 20, fontWeight: 500 },
  linkPrimary: { fontSize: 13, lineHeight: 20, fontWeight: 500, color: Gallery.accent },
  code: { fontFamily: Fonts.mono, fontWeight: Platform.select({ android: 700 }) ?? 500, fontSize: 12 },
});
