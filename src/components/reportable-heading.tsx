import { Image } from "expo-image";
import { router } from "expo-router";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { MotionPressable } from "@/components/motion-pressable";
import { ThemedText, useTextScale } from "@/components/themed-text";
import { Gallery, Spacing } from "@/constants/theme";
import { type ContentReportTarget, REPORT_NOUNS, reportHref } from "@/lib/social/report";

/** A heading over generated content, with Report at its end once there is content to report. */
export function ReportableHeading({
  report,
  disabled = false,
  maxFontSizeMultiplier,
  children,
}: {
  report?: ContentReportTarget;
  disabled?: boolean;
  /** Caps only Report's text scale; a capped heading passes its own cap here too. */
  maxFontSizeMultiplier?: number;
  children: ReactNode;
}) {
  const flag = FLAG_SIZE * useTextScale(maxFontSizeMultiplier);
  return (
    <View style={styles.row}>
      <View style={styles.heading}>{children}</View>
      {report && (
        <MotionPressable
          accessibilityRole="button"
          accessibilityLabel={`Report ${REPORT_NOUNS[report.kind]}`}
          accessibilityState={{ disabled }}
          disabled={disabled}
          hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
          onPress={() =>
            router.push(
              report.kind === "scanDocent"
                ? reportHref(report.kind, report.scanId)
                : reportHref(report.kind, report.artworkId, report.kind === "audio" ? report.renderId : undefined),
            )
          }
          style={[styles.report, { opacity: disabled ? 0.4 : 1 }]}
        >
          <Image source="sf:flag" tintColor={Gallery.muted} style={{ width: flag, height: flag }} accessible={false} />
          <ThemedText variant="secondary" themeColor="textSecondary" maxFontSizeMultiplier={maxFontSizeMultiplier}>
            Report
          </ThemedText>
        </MotionPressable>
      )}
    </View>
  );
}

// Drawn for Report's 14-point text, the flag grows with it.
const FLAG_SIZE = 13;

const styles = StyleSheet.create({
  // Wraps Report under a heading that no longer leaves room for it at large text sizes.
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    columnGap: Spacing.compact,
  },
  heading: { flexShrink: 1 },
  report: { flexDirection: "row", alignItems: "center", gap: Spacing.one },
});
