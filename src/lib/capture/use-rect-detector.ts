import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';
import { CommonResolutions, useFrameOutput, type Frame } from 'react-native-vision-camera';
import { scheduleOnRN } from 'react-native-worklets';

import { getVisionRect, type RectDetection } from '../../../modules/vision-rect/src';
import { RectTrackerStore, quadArea, type Guidance } from './rectangle';
import type { Quad } from './stages';

/** Every third frame sustained about 10 Vision calls/s on the iPhone 16 Pro. */
export const DETECTION_STRIDE = 3;

export type LiveQuad = { quad: Quad; frameWidth: number; frameHeight: number } | null;

export type RectDetector = {
  frameOutput: ReturnType<typeof useFrameOutput>;
  liveQuad: SharedValue<LiveQuad>;
  guidance: Guidance;
  ready: boolean;
  getCaptureQuad: () => Quad | null;
};

export function useRectDetector(active: boolean): RectDetector {
  const detector = useMemo(() => getVisionRect(), []);
  const store = useMemo(() => new RectTrackerStore(), []);
  const liveQuad = useSharedValue<LiveQuad>(null);
  const guidance = useSyncExternalStore(store.subscribe, store.getGuidance);
  const lastLogAt = useRef(0);

  const onDetection = useCallback((detection: RectDetection) => {
    const now = performance.now();
    const next = store.push(detection, now);
    liveQuad.set(next.quad ? { quad: next.quad, frameWidth: detection.width, frameHeight: detection.height } : null);
    if (__DEV__ && now - lastLogAt.current > 1000) {
      lastLogAt.current = now;
      console.debug('Rect tracker', {
        guidance: next.guidance,
        jitter: Number(next.jitter.toFixed(4)),
        candidates: detection.observations.length,
        area: next.quad ? Number(quadArea(next.quad).toFixed(3)) : 0,
        frame: `${detection.width}×${detection.height}`,
      });
    }
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

  return { frameOutput, liveQuad, guidance, ready: guidance === 'ready', getCaptureQuad: () => store.captureQuad };
}
