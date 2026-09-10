import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';
import { CommonResolutions, useFrameOutput, type Frame } from 'react-native-vision-camera';
import { scheduleOnRN } from 'react-native-worklets';

import { getVisionRect, type RectDetection } from '../../../modules/vision-rect/src';
import { RectTrackerStore, type Guidance } from './rectangle';
import type { Quad } from './stages';

/** Every third frame sustained about 10 Vision calls/s in decision 006. */
export const DETECTION_STRIDE = 3;

export type LiveQuad = { quad: Quad; frameWidth: number; frameHeight: number } | null;

export type RectDetector = {
  frameOutput: ReturnType<typeof useFrameOutput>;
  liveQuad: SharedValue<LiveQuad>;
  guidance: Guidance;
  ready: boolean;
  getQuad: () => Quad | null;
};

export function useRectDetector(active: boolean): RectDetector {
  const detector = useMemo(() => getVisionRect(), []);
  const store = useMemo(() => new RectTrackerStore(), []);
  const liveQuad = useSharedValue<LiveQuad>(null);
  const guidance = useSyncExternalStore(store.subscribe, store.getGuidance);

  const onDetection = useCallback((detection: RectDetection) => {
    const next = store.push(detection, performance.now());
    liveQuad.set(next.quad ? { quad: next.quad, frameWidth: detection.width, frameHeight: detection.height } : null);
  }, [liveQuad, store]);

  useEffect(() => {
    if (active) return;
    store.reset();
    liveQuad.set(null);
  }, [active, liveQuad, store]);

  const onFrame = useCallback((frame: Frame) => {
    'worklet';
    try {
      const detection = detector.detect(frame, DETECTION_STRIDE);
      if (detection) scheduleOnRN(onDetection, detection);
    } finally {
      frame.dispose();
    }
  }, [detector, onDetection]);

  // 4:3 keeps the frame and the default photo output on the same field of view, so normalized quads transfer.
  const frameOutput = useFrameOutput({ targetResolution: CommonResolutions.HD_4_3, pixelFormat: 'yuv', onFrame });

  return { frameOutput, liveQuad, guidance, ready: guidance === 'ready', getQuad: () => store.quad };
}
