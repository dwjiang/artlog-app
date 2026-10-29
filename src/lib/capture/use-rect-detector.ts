import { useCallback, useEffect, useMemo, useRef } from "react";
import { CommonResolutions, useFrameOutput, type CameraOrientation, type Frame } from "react-native-vision-camera";
import { scheduleOnRN } from "react-native-worklets";

import { getVisionRect, type RectDetection } from "../../../modules/vision-rect/src";
import { STABLE_WINDOW_MS } from "./rectangle";

export const DETECTION_STRIDE = 3;
// A queued burst must not be old enough to satisfy a whole stability window.
const MAX_REPORT_DELAY_MS = STABLE_WINDOW_MS / 2;

/**
 * Streams camera frames through native rectangle detection and reports each result on the JS thread with its frame's
 * time in milliseconds, so a busy JS thread delivering results late does not read as a gap in detections.
 */
export function useRectDetector(
  active: boolean,
  orientation: CameraOrientation,
  onDetection: (detection: RectDetection, at: number) => void,
  onReset: () => void,
) {
  const detector = useMemo(() => getVisionRect(), []);
  const callbacks = useRef({ onDetection, onReset });
  const enabled = useRef(false);
  const enabledSince = useRef(Infinity);
  useEffect(() => {
    callbacks.current = { onDetection, onReset };
  }, [onDetection, onReset]);
  useEffect(() => {
    enabled.current = active;
    enabledSince.current = Date.now();
    callbacks.current.onReset();
    return () => {
      enabled.current = false;
    };
  }, [active, orientation]);
  const report = useCallback((detection: RectDetection, at: number, startedAt: number, scheduledAt: number) => {
    if (!enabled.current || startedAt < enabledSince.current) return;
    if (Date.now() - scheduledAt > MAX_REPORT_DELAY_MS) {
      callbacks.current.onReset();
      return;
    }
    callbacks.current.onDetection(detection, at);
  }, []);
  const onFrame = useCallback(
    (frame: Frame) => {
      "worklet";
      try {
        if (!active) return;
        // Wall time spans runtimes; camera timestamps retain the hold's timing independently of native detection cost.
        const startedAt = Date.now();
        const detection = detector.detect(frame, DETECTION_STRIDE);
        if (detection) scheduleOnRN(report, detection, frame.timestamp * 1000, startedAt, Date.now());
      } finally {
        frame.dispose();
      }
    },
    [active, detector, report],
  );

  // Match the default photo output's field of view so normalized corners transfer.
  const output = useFrameOutput({
    targetResolution: CommonResolutions.HD_4_3,
    pixelFormat: "yuv",
    onFrame,
  });
  useEffect(() => {
    // Corners are reported in this orientation, so it follows the preview's for the outline to land on the painting.
    // oxlint-disable-next-line react/immutability -- VisionCamera outputs take their orientation through a native setter.
    output.outputOrientation = orientation;
  }, [output, orientation]);
  return output;
}
