import { BottomSheet, RNHostView } from "@expo/ui";
import { ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";

import { GalleryButton } from "@/components/collection/gallery-button";
import { ThemedText } from "@/components/themed-text";
import { Colors, Spacing } from "@/constants/theme";
import { useFittedSheetHeight } from "@/hooks/use-fitted-sheet";
import type { ResultCandidate } from "@/lib/result/state";

import { RunnerUps } from "./runner-ups";

export type NotRightSheetProps = {
  open: boolean;
  onDismiss: () => void;
  runnerUps: ResultCandidate[];
  onPick: (candidate: ResultCandidate) => void;
  onLabel: () => void;
  onManual?: () => void;
  onSavePhoto?: () => void;
  /** A one-line note when the rejection could not be recorded; the choices stay usable. */
  notice?: string;
};

export function NotRightSheet({
  open,
  onDismiss,
  runnerUps,
  onPick,
  onLabel,
  onManual,
  onSavePhoto,
  notice,
}: NotRightSheetProps) {
  const hasRunnerUps = runnerUps.length > 0;
  const { fontScale } = useWindowDimensions();
  const scrollAll = fontScale > 1.4;
  const fitted = useFittedSheetHeight({ scrollAll });
  const header = (
    <View style={styles.header} onLayout={fitted.onHeaderLayout}>
      <ThemedText type="subtitle" accessibilityRole="header" style={styles.title}>
        {hasRunnerUps ? "Other possible matches" : "No other matches found"}
      </ThemedText>
      <GalleryButton label="Close matches" icon="xmark" iconOnly tone="ink" fullWidth={false} onPress={onDismiss} />
    </View>
  );
  const footer = (
    <View style={styles.footer} onLayout={fitted.onFooterLayout}>
      <GalleryButton label="Scan the museum label" variant="filled" fullWidth onPress={onLabel} />
      {onManual && (
        <GalleryButton
          label="Enter details manually"
          variant="filled"
          tone="neutral"
          size="compact"
          fullWidth
          onPress={onManual}
        />
      )}
      {onSavePhoto && (
        <GalleryButton
          label="Save photo only"
          variant="filled"
          tone="neutral"
          size="compact"
          fullWidth
          onPress={onSavePhoto}
        />
      )}
    </View>
  );
  return (
    <BottomSheet
      contentPadding={0}
      snapPoints={[fitted.height ? { height: fitted.height } : "half"]}
      containerColor={Colors.light.background}
      isPresented={open}
      onDismiss={onDismiss}
    >
      <RNHostView>
        <View style={{ height: fitted.height }}>
          {!scrollAll && header}
          <ScrollView
            accessibilityLabel="Possible matches"
            alwaysBounceVertical={false}
            onContentSizeChange={fitted.onContentSizeChange}
          >
            {scrollAll && header}
            <View style={styles.content}>
              {notice && (
                <ThemedText type="small" themeColor="error" accessibilityRole="alert">
                  {notice}
                </ThemedText>
              )}
              {hasRunnerUps && <RunnerUps candidates={runnerUps} onPick={onPick} />}
            </View>
            {scrollAll && footer}
          </ScrollView>
          {!scrollAll && footer}
        </View>
      </RNHostView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingHorizontal: Spacing.content,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
  },
  title: { flex: 1 },
  content: {
    gap: Spacing.three,
    paddingHorizontal: Spacing.content,
    paddingBottom: Spacing.two,
  },
  footer: {
    gap: Spacing.two,
    padding: Spacing.content,
    paddingTop: Spacing.three,
  },
});
