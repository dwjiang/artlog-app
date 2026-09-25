import { useSyncExternalStore } from "react";
import { StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Colors, Spacing } from "@/constants/theme";
import type { CaptureFeedback } from "@/lib/capture/capture-controller";
import type { CaptureTimings } from "@/lib/capture/stages";
import { useDevTimings } from "@/lib/settings/use-dev-timings";

import type { RectDetection } from "../../../modules/vision-rect/src";

const DETECTION_WINDOW_MS = 1000;
type DetectionSample = { at: number; found: boolean; confidence: number };

export function formatCaptureTimings({ total, ...stages }: CaptureTimings): string {
  const parts = Object.entries(stages).map(([stage, ms]) => `${stage} ${Math.round(ms)}`);
  return [`Capture ${Math.round(total)} ms`, ...parts].join(" · ");
}

export function formatDetection(samples: DetectionSample[], feedback: CaptureFeedback): string {
  const hits = samples.filter((sample) => sample.found).length;
  const best = Math.max(0, ...samples.map((sample) => sample.confidence));
  const state = feedback ? `${feedback.guidance} ${Math.round(feedback.progress * 100)}%` : "no candidate";
  return `Detect ${hits}/${samples.length} frames · best ${best.toFixed(2)} · ${state}`;
}

/**
 * Development builds only: the detector's hit rate and best confidence over the last second, and what the
 * controller made of it. Only `DevTimings` subscribes, so recording every detection re-renders nothing else.
 */
export class DetectionLog {
  private samples: DetectionSample[] = [];
  private line?: string;
  private listeners = new Set<() => void>();

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  readonly getLine = () => this.line;

  record(detection: RectDetection, feedback: CaptureFeedback) {
    if (!__DEV__) return;
    const at = performance.now();
    this.samples = [
      ...this.samples.filter((sample) => sample.at > at - DETECTION_WINDOW_MS),
      { at, found: detection.observations.length > 0, confidence: detection.observations[0]?.confidence ?? 0 },
    ];
    this.line = formatDetection(this.samples, feedback);
    this.listeners.forEach((listener) => listener());
  }
}

const unsubscribed = () => () => {};

/** Development builds only: the stage breakdown of the last capture and the live detection line, tucked bottom-left over the preview. */
export function DevTimings({ timings, detection }: { timings?: CaptureTimings; detection?: DetectionLog }) {
  const { enabled } = useDevTimings();
  const on = __DEV__ && enabled === true;
  const line = useSyncExternalStore(on && detection ? detection.subscribe : unsubscribed, () =>
    on ? detection?.getLine() : undefined,
  );
  if (!on || (!timings && !line)) return null;
  return (
    <View style={styles.timings}>
      {timings && (
        <ThemedText type="code" themeColor="overlayText">
          {formatCaptureTimings(timings)}
        </ThemedText>
      )}
      {line && (
        <ThemedText type="code" themeColor="overlayText">
          {line}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  timings: {
    alignSelf: "flex-start",
    backgroundColor: Colors.light.overlayScrim,
    borderRadius: Spacing.two,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
  },
});
