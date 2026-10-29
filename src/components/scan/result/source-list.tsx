import { BottomSheet, RNHostView } from "@expo/ui";
import { Image } from "expo-image";
import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import { MotionPressable } from "@/components/motion-pressable";
import { CloseButton } from "@/components/sheet-controls";
import { ThemedText } from "@/components/themed-text";
import { CompactBarMaxTextScale, Gallery, Radius, Spacing } from "@/constants/theme";
import { useFittedSheetHeight } from "@/hooks/use-fitted-sheet";
import { sourceLicence } from "@/lib/result/source-licence";

import { SourceLink } from "./source-chip";

export type NumberedSource = { number: number; label: string; url: string };

/** One row counting the cited pages; it opens a sheet listing each page with its licence. */
export function SourceList({ sources }: { sources: NumberedSource[] }) {
  const [open, setOpen] = useState(false);
  if (sources.length === 0) return null;
  const count = `${sources.length} ${sources.length === 1 ? "source" : "sources"}`;
  const initials = [...new Set(sources.map(({ label }) => label.charAt(0).toUpperCase()))].slice(0, 3);
  return (
    <>
      <MotionPressable
        accessibilityRole="button"
        accessibilityLabel={count}
        accessibilityHint="Lists each source and its licence."
        onPress={() => setOpen(true)}
        style={styles.summary}
      >
        <View style={styles.initials}>
          {initials.map((initial, index) => (
            <View key={initial} style={[styles.initial, index > 0 && styles.overlap]}>
              <ThemedText maxFontSizeMultiplier={CompactBarMaxTextScale} style={styles.initialText}>
                {initial}
              </ThemedText>
            </View>
          ))}
        </View>
        <ThemedText variant="metadata" style={styles.count}>
          {count}
        </ThemedText>
        <Image source="sf:chevron.right" tintColor={Gallery.muted} style={styles.chevron} />
      </MotionPressable>
      <SourcesSheet open={open} onDismiss={() => setOpen(false)} sources={sources} />
    </>
  );
}

function SourcesSheet({
  open,
  onDismiss,
  sources,
}: {
  open: boolean;
  onDismiss: () => void;
  sources: NumberedSource[];
}) {
  const fitted = useFittedSheetHeight();
  return (
    <BottomSheet
      contentPadding={0}
      snapPoints={[fitted.height ? { height: fitted.height } : "half"]}
      containerColor={Gallery.groupedBackground}
      isPresented={open}
      onDismiss={onDismiss}
    >
      <RNHostView>
        <View style={{ height: fitted.height }}>
          <View style={styles.header} onLayout={fitted.onHeaderLayout}>
            <ThemedText type="subtitle" accessibilityRole="header" style={styles.title}>
              Sources
            </ThemedText>
            <CloseButton onPress={onDismiss} />
          </View>
          <ScrollView alwaysBounceVertical={false} onContentSizeChange={fitted.onContentSizeChange}>
            <View style={styles.card}>
              {sources.map(({ number, label, url }, index) => {
                const licence = sourceLicence(url);
                return (
                  <View key={url} style={[styles.row, index > 0 && styles.separator]}>
                    <View style={[styles.rowNumber, licence && styles.sourceWithLicence]}>
                      <SourceNumber number={number} />
                    </View>
                    <View style={styles.rowLinks}>
                      <SourceLink label={label} url={url} style={[styles.link, licence && styles.sourceWithLicence]}>
                        <ThemedText style={styles.label}>{label}</ThemedText>
                        <Image source="sf:arrow.up.right" tintColor={Gallery.muted} style={styles.open} />
                      </SourceLink>
                      {licence && (
                        <SourceLink
                          label={`${label}, licensed ${licence.name}`}
                          url={licence.url}
                          style={[styles.link, styles.licenceLink]}
                        >
                          <ThemedText variant="secondary" themeColor="textSecondary" style={styles.licence}>
                            {licence.name}
                          </ThemedText>
                          <Image source="sf:arrow.up.right" tintColor={Gallery.muted} style={styles.open} />
                        </SourceLink>
                      )}
                    </View>
                  </View>
                );
              })}
            </View>
            <ThemedText variant="metadata" themeColor="textSecondary" style={styles.footer}>
              Source text summarized
            </ThemedText>
          </ScrollView>
        </View>
      </RNHostView>
    </BottomSheet>
  );
}

export function SourceNumber({ number }: { number: number }) {
  return (
    <View style={styles.number}>
      <ThemedText style={styles.numberText}>{number}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  summary: { flexDirection: "row", alignItems: "center", gap: Spacing.two, minHeight: 44 },
  initials: { flexDirection: "row" },
  initial: {
    width: 22,
    height: 22,
    borderRadius: Radius.full,
    borderWidth: 1.5,
    borderColor: Gallery.paper,
    backgroundColor: Gallery.avatar,
    alignItems: "center",
    justifyContent: "center",
  },
  overlap: { marginLeft: -Spacing.two },
  initialText: { fontSize: 10, lineHeight: 12, fontWeight: "600", color: Gallery.ink },
  count: { flex: 1, fontWeight: "500", color: Gallery.accent },
  chevron: { width: 7, height: 12 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingHorizontal: Spacing.content,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
  },
  title: { flex: 1 },
  card: {
    marginHorizontal: Spacing.content,
    marginBottom: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.card,
    backgroundColor: Gallery.surface,
  },
  footer: { marginHorizontal: Spacing.content, marginBottom: Spacing.content },
  row: { flexDirection: "row", alignItems: "flex-start", gap: Spacing.compact },
  separator: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Gallery.separator },
  rowNumber: { minHeight: 44, justifyContent: "center" },
  rowLinks: { flex: 1 },
  link: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    minHeight: 44,
    paddingVertical: Spacing.one,
  },
  sourceWithLicence: { paddingTop: Spacing.three, paddingBottom: 0 },
  licenceLink: { paddingTop: 0, paddingBottom: Spacing.three },
  label: { flexShrink: 1, fontWeight: "500", color: Gallery.accent },
  licence: { flexShrink: 1 },
  open: { width: 10, height: 10 },
  number: {
    minWidth: 18,
    minHeight: 18,
    paddingHorizontal: Spacing.one,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Gallery.highlight,
  },
  numberText: {
    fontSize: 11,
    lineHeight: 13,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
    color: Gallery.accent,
  },
});
