import { Image } from "expo-image";
import type { ComponentProps, ReactNode } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";

import { Gallery, Radius, Spacing } from "@/constants/theme";

import { ActionStack } from "./action-stack";
import { GalleryButton } from "./collection/gallery-button";
import { ThemedText as Text } from "./themed-text";

export type EmptyAction = { label: string; icon?: ComponentProps<typeof GalleryButton>["icon"]; onPress: () => void };

export function EmptyState({
  title,
  detail,
  visual,
  children,
  footnote,
  compact = false,
  inset = true,
}: {
  title: string;
  detail?: string;
  visual?: ReactNode;
  children?: ReactNode;
  footnote?: string;
  compact?: boolean;
  inset?: boolean;
}) {
  const { fontScale } = useWindowDimensions();
  return (
    <View style={[styles.root, inset && !compact && styles.inset, compact && styles.compact]}>
      {visual && <View style={styles.visual}>{visual}</View>}
      <View style={styles.copy}>
        <Text
          variant="display"
          accessibilityRole="header"
          lineBreakStrategyIOS="push-out"
          style={[
            compact || !visual ? styles.smallTitle : fontScale > 1.3 ? styles.largeTextTitle : styles.title,
            styles.centeredText,
          ]}
        >
          {title}
        </Text>
        {detail && (
          <Text lineBreakStrategyIOS="push-out" style={[styles.detail, styles.centeredText]}>
            {detail}
          </Text>
        )}
      </View>
      {children && <View style={styles.actions}>{children}</View>}
      {footnote && (
        <Text lineBreakStrategyIOS="push-out" style={[styles.footnote, styles.centeredText]}>
          {footnote}
        </Text>
      )}
    </View>
  );
}

/** An empty state's primary button with an optional text button flush beneath it. */
export function EmptyActions({ action, secondaryAction }: { action?: EmptyAction; secondaryAction?: EmptyAction }) {
  return (
    <ActionStack
      textActions={
        secondaryAction && <GalleryButton label={secondaryAction.label} onPress={secondaryAction.onPress} fullWidth />
      }
    >
      {action && (
        <GalleryButton label={action.label} icon={action.icon} onPress={action.onPress} variant="filled" fullWidth />
      )}
    </ActionStack>
  );
}

/** An empty state set as a gray card in the page gutter, for a section that sits under other content. */
export function EmptyCard({
  title,
  detail,
  action,
  secondaryAction,
}: {
  title: string;
  detail?: string;
  action?: EmptyAction;
  secondaryAction?: EmptyAction;
}) {
  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.cardTitle}>
        {title}
      </Text>
      {detail && <Text style={styles.cardDetail}>{detail}</Text>}
      {(action || secondaryAction) && (
        <View style={styles.cardActions}>
          {action && (
            <GalleryButton
              label={action.label}
              icon={action.icon}
              onPress={action.onPress}
              variant="filled"
              size="compact"
            />
          )}
          {secondaryAction && (
            <GalleryButton label={secondaryAction.label} onPress={secondaryAction.onPress} size="compact" />
          )}
        </View>
      )}
    </View>
  );
}

export function EmptySymbol({ name, size = 76 }: { name: string; size?: number }) {
  return (
    <View accessibilityElementsHidden style={[styles.symbol, { width: size, height: size, borderRadius: size / 2 }]}>
      <Image
        source={`sf:${name}`}
        tintColor={Gallery.muted}
        style={{ width: size * 0.38, height: size * 0.38 }}
        accessible={false}
      />
    </View>
  );
}

export function SearchEmptyState({
  title = "No results found.",
  detail,
  onClear,
}: {
  title?: string;
  detail: string;
  onClear?: () => void;
}) {
  return (
    <EmptyState title={title} detail={detail} visual={<EmptySymbol name="magnifyingglass" size={132} />}>
      {onClear && <GalleryButton label="Clear search" variant="filled" fullWidth onPress={onClear} />}
    </EmptyState>
  );
}

const styles = StyleSheet.create({
  root: { gap: 24, width: "100%", maxWidth: 520, alignSelf: "center" },
  inset: { paddingHorizontal: 20, paddingTop: 36, paddingBottom: 28 },
  compact: {
    gap: 12,
    padding: 20,
    backgroundColor: Gallery.fill,
    borderRadius: 8,
  },
  copy: { gap: 10, alignItems: "center" },
  visual: { alignItems: "center" },
  centeredText: { textAlign: "center" },
  title: { fontSize: 40, lineHeight: 46, maxWidth: 330 },
  largeTextTitle: { fontSize: 32, lineHeight: 40 },
  smallTitle: { fontSize: 26, lineHeight: 32 },
  detail: { color: Gallery.muted, fontSize: 15, lineHeight: 23 },
  footnote: { color: Gallery.muted, fontSize: 12, lineHeight: 18 },
  actions: { gap: 8, alignItems: "stretch" },
  card: {
    marginHorizontal: Spacing.content,
    marginTop: Spacing.compact,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: Spacing.three,
    gap: Spacing.one,
    backgroundColor: Gallery.fill,
    borderRadius: Radius.card,
  },
  cardTitle: { fontSize: 17, lineHeight: 22, fontWeight: "600", color: Gallery.ink },
  cardDetail: { fontSize: 14, lineHeight: 21, color: Gallery.muted },
  cardActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: 10,
    marginTop: Spacing.compact,
  },
  symbol: {
    width: 76,
    height: 76,
    borderRadius: 38,
    // Avatar blue, not fill, so the circle still shows on grouped (gray) pages.
    backgroundColor: Gallery.avatar,
    alignItems: "center",
    justifyContent: "center",
  },
});
