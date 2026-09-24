import { BottomSheet, RNHostView } from "@expo/ui";
import { ScrollView, StyleSheet } from "react-native";

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

/** "Not right?": runner-ups first, then the label. */
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
  const fitted = useFittedSheetHeight();
  return (
    <BottomSheet
      contentPadding={0}
      snapPoints={[fitted.height ? { height: fitted.height } : "half"]}
      containerColor={Colors.light.background}
      isPresented={open}
      onDismiss={onDismiss}
    >
      <RNHostView>
        <ScrollView
          style={{ height: fitted.height }}
          contentContainerStyle={styles.content}
          alwaysBounceVertical={false}
          onContentSizeChange={fitted.onContentSizeChange}
        >
          <ThemedText type="subtitle">{hasRunnerUps ? "Other possible matches" : "No other matches found"}</ThemedText>
          {notice && (
            <ThemedText type="small" themeColor="error" accessibilityRole="alert">
              {notice}
            </ThemedText>
          )}
          {hasRunnerUps && <RunnerUps candidates={runnerUps} onPick={onPick} />}
          <GalleryButton label="Scan the museum label" variant="filled" fullWidth onPress={onLabel} />
          {onManual && <GalleryButton label="Enter details myself" fullWidth onPress={onManual} />}
          {onSavePhoto && <GalleryButton label="Save just the photo" fullWidth onPress={onSavePhoto} />}
          <GalleryButton label="Back to result" fullWidth onPress={onDismiss} />
        </ScrollView>
      </RNHostView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: Spacing.three,
    padding: Spacing.content,
    paddingTop: Spacing.four,
  },
});
