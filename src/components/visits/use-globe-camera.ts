import { useEffect, useEffectEvent } from "react";
import { Gesture } from "react-native-gesture-handler";
import { cancelAnimation, ReduceMotion, useDerivedValue, useSharedValue, withDecay } from "react-native-reanimated";
import { scheduleOnRN, scheduleOnUI } from "react-native-worklets";
import type { GlobeCamera } from "@/lib/journal/globe-geometry";

const YAW_PER_POINT = 0.34;
const PITCH_PER_POINT = 0.28;
const MAX_PITCH = 75;

export function useGlobeCamera(initialCamera: GlobeCamera, onCameraChange?: (camera: GlobeCamera) => void) {
  const yaw = useSharedValue(initialCamera.yaw);
  const pitch = useSharedValue(initialCamera.pitch);
  const zoom = useSharedValue(initialCamera.zoom);
  const remainingDecays = useSharedValue(0);
  const panning = useSharedValue(false);
  const pinching = useSharedValue(false);
  const start = useSharedValue(initialCamera);
  const pinchStartZoom = useSharedValue(initialCamera.zoom);
  const camera = useDerivedValue(() => ({
    yaw: yaw.get(),
    pitch: pitch.get(),
    zoom: zoom.get(),
  }));

  function readCamera(): GlobeCamera {
    "worklet";
    return { yaw: yaw.get(), pitch: pitch.get(), zoom: zoom.get() };
  }
  function save() {
    "worklet";
    if (onCameraChange) scheduleOnRN(onCameraChange, readCamera());
  }
  function stop() {
    "worklet";
    remainingDecays.set(0);
    cancelAnimation(yaw);
    cancelAnimation(pitch);
  }
  function saveIfIdle() {
    "worklet";
    if (!panning.get() && !pinching.get() && remainingDecays.get() === 0) {
      save();
    }
  }
  function setCamera(value: GlobeCamera) {
    "worklet";
    stop();
    yaw.set(value.yaw);
    pitch.set(value.pitch);
    zoom.set(value.zoom);
    save();
  }
  function finishDecay(finished?: boolean) {
    "worklet";
    if (!finished) return;
    remainingDecays.set(remainingDecays.get() - 1);
    saveIfIdle();
  }

  // Session updates also reach the globe underneath the expanded modal.
  const syncCamera = useEffectEvent((value: GlobeCamera) => {
    scheduleOnUI(() => {
      "worklet";
      if (yaw.get() === value.yaw && pitch.get() === value.pitch && zoom.get() === value.zoom) {
        return;
      }
      stop();
      yaw.set(value.yaw);
      pitch.set(value.pitch);
      zoom.set(value.zoom);
    });
  });
  const { yaw: initialYaw, pitch: initialPitch, zoom: initialZoom } = initialCamera;
  useEffect(() => {
    syncCamera({ yaw: initialYaw, pitch: initialPitch, zoom: initialZoom });
  }, [initialYaw, initialPitch, initialZoom]);
  // Ends any momentum and persists the position it reached, so a globe mounted next reads a live camera.
  function settle() {
    stop();
    onCameraChange?.(readCamera());
  }
  const settleOnUnmount = useEffectEvent(settle);
  useEffect(() => () => settleOnUnmount(), []);

  const pan = Gesture.Pan()
    .maxPointers(1)
    .minDistance(4)
    .onBegin(stop)
    .onStart(() => {
      panning.set(true);
      start.set(readCamera());
    })
    .onUpdate((event) => {
      const origin = start.get();
      // Leave yaw unwrapped so a flick crosses the date line without a discontinuity.
      yaw.set(origin.yaw + (event.translationX * YAW_PER_POINT) / origin.zoom);
      pitch.set(
        Math.max(-MAX_PITCH, Math.min(MAX_PITCH, origin.pitch + (event.translationY * PITCH_PER_POINT) / origin.zoom)),
      );
    })
    .onEnd((event, success) => {
      if (!success || pinching.get()) return;
      remainingDecays.set(2);
      yaw.set(
        withDecay(
          {
            velocity: (event.velocityX * YAW_PER_POINT) / zoom.get(),
            reduceMotion: ReduceMotion.System,
          },
          finishDecay,
        ),
      );
      pitch.set(
        withDecay(
          {
            velocity: (event.velocityY * PITCH_PER_POINT) / zoom.get(),
            clamp: [-MAX_PITCH, MAX_PITCH],
            reduceMotion: ReduceMotion.System,
          },
          finishDecay,
        ),
      );
    })
    .onFinalize(() => {
      panning.set(false);
      saveIfIdle();
    });
  const pinch = Gesture.Pinch()
    .onStart(() => {
      stop();
      pinching.set(true);
      pinchStartZoom.set(zoom.get());
    })
    .onUpdate((event) => {
      zoom.set(Math.max(0.75, Math.min(2.25, pinchStartZoom.get() * event.scale)));
    })
    .onFinalize(() => {
      pinching.set(false);
      saveIfIdle();
    });

  return { camera, pan, pinch, setCamera, settle, stop, save };
}
