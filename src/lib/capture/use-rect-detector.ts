import { useCallback, useEffect, useMemo, useRef } from "react";
import { CommonResolutions, useFrameOutput, type CameraOrientation, type Frame } from "react-native-vision-camera";
import { scheduleOnRN } from "react-native-worklets";

import { getVisionRect, type RectDetection } from "../../../modules/vision-rect/src";

export const DETECTION_STRIDE = 3;

/** Streams camera frames through native rectangle detection and reports each result on the JS thread. */
export function useRectDetector(
  active: boolean,
  orientation: CameraOrientation,
  onDetection: (detection: RectDetection) => void,
) {
  const detector = useMemo(() => getVisionRect(), []);
  const callback = useRef(onDetection);
  const enabled = useRef(active);
  useEffect(() => {
    callback.current = onDetection;
    enabled.current = active;
  }, [active, onDetection]);
  const report = useCallback((detection: RectDetection) => {
    if (enabled.current) callback.current(detection);
  }, []);
  const onFrame = useCallback(
    (frame: Frame) => {
      "worklet";
      try {
        if (!active) return;
        const detection = detector.detect(frame, DETECTION_STRIDE);
        if (detection) scheduleOnRN(report, detection);
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
