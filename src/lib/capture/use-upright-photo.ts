import { useCallback, useEffect, useState } from "react";
import { VisionCamera, type CameraOrientation, type CameraPhotoOutput } from "react-native-vision-camera";

const QUARTER_TURNS: Record<CameraOrientation, number> = { up: 0, right: 1, down: 2, left: 3 };

export type UprightPhoto = { filePath: string; turns: number };

/** Clockwise quarter turns from a preview shown in the `preview` orientation to a photo taken in the `photo` one. */
export function photoTurns(preview: CameraOrientation, photo: CameraOrientation) {
  return (QUARTER_TURNS[photo] - QUARTER_TURNS[preview] + 4) % 4;
}

/**
 * Takes photos upright to how the phone is held, as the Camera app does, while the preview and frames keep the
 * interface orientation (`preview`). Pair it with `orientationSource="custom"`: the Camera otherwise re-applies its
 * own orientation to every output whenever its outputs change.
 */
export function useUprightPhoto(
  output: CameraPhotoOutput,
  preview: CameraOrientation,
  active: boolean,
): () => Promise<UprightPhoto> {
  const [device] = useState(() => VisionCamera.createOrientationManager("device"));
  useEffect(() => {
    if (!active) return;
    try {
      // The manager tracks the accelerometer itself; the shutter reads where it settled.
      device.startOrientationUpdates(() => {});
    } catch {
      // The iOS Simulator has no accelerometer, so its photos match the preview.
      return;
    }
    return () => device.stopOrientationUpdates();
  }, [device, active]);
  return useCallback(async () => {
    // Flat on its back the phone has no orientation, so the last one held stays.
    const orientation = device.currentOrientation ?? preview;
    // oxlint-disable-next-line react/immutability -- VisionCamera outputs take their orientation through a native setter.
    output.outputOrientation = orientation;
    const { filePath } = await output.capturePhotoToFile({}, {});
    return { filePath, turns: photoTurns(preview, orientation) };
  }, [device, output, preview]);
}
