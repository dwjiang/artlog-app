import { Image } from "expo-image";
import type { ReactNode } from "react";
import { type AccessibilityRole, Pressable, StyleSheet, View } from "react-native";

import { LoadingRing } from "@/components/loading-ring";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, Radius, SettingsOutline, Spacing, Typography } from "@/constants/theme";
import { highlightMatch } from "@/lib/ui/highlight-match";

/** `check` marks the one chosen row; `toggle` shows a circle on every row of a multi-select list. */
type Accessory = "chevron" | "check" | "toggle";

/**
 * A row of a grouped list. Rows stack into one card: pass `first` and `last` so the ends round and the
 * last row drops its separator. A white card belongs on a grouped (gray) page; on paper, wrap the rows
 * in an outlined `ListSection`.
 */
export function ListRow({
  title,
  query,
  subtitle,
  leading,
  detail,
  trailing,
  accessory,
  selected = false,
  busy = false,
  first = false,
  last = false,
  onPress,
  disabled = false,
  accessibilityLabel = title,
  accessibilityHint,
  accessibilityRole = "button",
}: {
  title: string;
  /** Highlights the letters of `title` that match this search. */
  query?: string;
  subtitle?: ReactNode;
  leading?: ReactNode;
  detail?: string;
  trailing?: ReactNode;
  accessory?: Accessory;
  selected?: boolean;
  busy?: boolean;
  first?: boolean;
  last?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityRole?: AccessibilityRole;
}) {
  const chosen = selected && (accessory === "check" || accessory === "toggle");
  // A whole-row Pressable would make VoiceOver read the row as one element and hide the buttons in `trailing`,
  // so with both, the tap target sits behind the content and only `trailing` takes touches and focus.
  const behind = !!onPress && !!trailing;
  const passive = behind
    ? ({
        style: styles.passive,
        accessibilityElementsHidden: true,
        importantForAccessibility: "no-hide-descendants",
      } as const)
    : undefined;
  const content = (
    <>
      {leading && (
        <View {...passive} style={[styles.leading, passive?.style]}>
          {leading}
        </View>
      )}
      <View style={[styles.content, !last && styles.separator, behind && styles.boxNone]}>
        <View {...passive} style={[styles.text, passive?.style]}>
          <Text style={[styles.title, chosen && accessory === "check" && styles.chosen]}>
            {query
              ? highlightMatch(title, query).map((part, index) =>
                  part.match ? (
                    <Text key={index} style={styles.match}>
                      {part.text}
                    </Text>
                  ) : (
                    part.text
                  ),
                )
              : title}
          </Text>
          {typeof subtitle === "string" ? <Text style={styles.subtitle}>{subtitle}</Text> : subtitle}
        </View>
        {detail && (
          <Text {...passive} style={[styles.detail, passive?.style]}>
            {detail}
          </Text>
        )}
        {trailing}
        <View {...passive}>
          {busy ? <LoadingRing size={18} /> : <RowAccessory kind={accessory} selected={selected} />}
        </View>
      </View>
    </>
  );
  const rowStyle = [styles.row, first && styles.first, last && styles.last];
  if (!onPress) return <View style={rowStyle}>{content}</View>;
  const target = {
    accessibilityRole,
    accessibilityLabel,
    accessibilityHint,
    accessibilityState: {
      disabled,
      busy,
      ...(accessory === "check" || accessory === "toggle"
        ? accessibilityRole === "radio" || accessibilityRole === "checkbox"
          ? { checked: selected }
          : { selected }
        : {}),
    },
    disabled,
    onPress,
  };
  if (behind) {
    return (
      <View style={rowStyle}>
        <Pressable
          {...target}
          style={({ pressed }) => [
            StyleSheet.absoluteFill,
            first && styles.first,
            last && styles.last,
            pressed && styles.pressed,
          ]}
        />
        {content}
      </View>
    );
  }
  return (
    <Pressable {...target} style={({ pressed }) => [rowStyle, pressed && styles.pressed]}>
      {content}
    </Pressable>
  );
}

function RowAccessory({ kind, selected }: { kind?: Accessory; selected: boolean }) {
  if (kind === "chevron") {
    return <Image source="sf:chevron.right" tintColor={Gallery.muted} style={styles.chevron} accessible={false} />;
  }
  if (kind === "check") {
    return selected ? (
      <Image source="sf:checkmark" tintColor={Gallery.accent} style={styles.check} accessible={false} />
    ) : (
      <View style={styles.check} />
    );
  }
  if (kind === "toggle") {
    return (
      <Image
        source={selected ? "sf:checkmark.circle.fill" : "sf:circle"}
        tintColor={selected ? Gallery.accent : Gallery.controlBorder}
        style={styles.toggle}
        accessible={false}
      />
    );
  }
  return null;
}

/** The leading tile of a grouped row: an SF Symbol in accent on pale blue. */
export function ListIcon({ name }: { name: string }) {
  return (
    <View style={styles.icon}>
      <Image source={`sf:${name}`} tintColor={Gallery.accent} style={styles.iconSymbol} accessible={false} />
    </View>
  );
}

export function ListSection({
  title,
  outlined = false,
  children,
}: {
  title?: string;
  /** Draws the card edge for rows shown on paper instead of a grouped page. */
  outlined?: boolean;
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      {title && (
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          {title}
        </Text>
      )}
      <View style={outlined && styles.outlined}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    minHeight: 44,
    gap: Spacing.compact,
    paddingLeft: Spacing.three,
    backgroundColor: Gallery.surface,
  },
  first: { borderTopLeftRadius: Radius.card, borderTopRightRadius: Radius.card },
  last: { borderBottomLeftRadius: Radius.card, borderBottomRightRadius: Radius.card },
  pressed: { backgroundColor: Gallery.separator },
  passive: { pointerEvents: "none" },
  boxNone: { pointerEvents: "box-none" },
  leading: { justifyContent: "center", paddingVertical: Spacing.two },
  content: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.compact,
    paddingVertical: Spacing.compact,
    paddingRight: Spacing.three,
  },
  separator: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Gallery.separator },
  text: { flex: 1, gap: Spacing.half },
  title: { ...Typography.body, color: Gallery.ink },
  chosen: { fontWeight: "600" },
  match: { color: Gallery.accent, backgroundColor: Gallery.highlight },
  subtitle: { ...Typography.secondary, color: Gallery.muted },
  detail: { ...Typography.secondary, color: Gallery.muted, fontVariant: ["tabular-nums"] },
  chevron: { width: 9, height: 15 },
  check: { width: 17, height: 17 },
  toggle: { width: 22, height: 22 },
  icon: {
    width: 32,
    height: 32,
    borderRadius: Radius.button,
    borderCurve: "continuous",
    backgroundColor: Gallery.highlight,
    alignItems: "center",
    justifyContent: "center",
  },
  iconSymbol: { width: 18, height: 18 },
  section: { gap: Spacing.two },
  sectionTitle: { ...Typography.eyebrow, color: Gallery.muted, paddingHorizontal: Spacing.three },
  outlined: { ...SettingsOutline, overflow: "hidden" },
});
