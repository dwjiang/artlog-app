import { useCallback, useEffect, useState } from "react";
import { VisionCamera, type CameraOrientation, type CameraPhotoOutput } from "react-native-vision-camera";

/** Clockwise quarter turns from the portrait preview to a photo taken with the phone held this way. */
const PHOTO_TURNS: Record<CameraOrientation, number> = { up: 0, right: 1, down: 2, left: 3 };

export type UprightPhoto = { filePath: string; turns: number };

/**
 * Takes photos upright to how the phone is held, as the Camera app does, while the portrait-locked
 * preview and frames keep the interface orientation. Pair it with `orientationSource="custom"`: the
 * Camera otherwise re-applies its own orientation to every output on each render.
 */
export function useUprightPhoto(output: CameraPhotoOutput, active: boolean): () => Promise<UprightPhoto> {
  const [device] = useState(() => VisionCamera.createOrientationManager("device"));
  useEffect(() => {
    if (!active) return;
    try {
      // The manager tracks the accelerometer itself; the shutter reads where it settled.
      device.startOrientationUpdates(() => {});
    } catch {
      // The iOS Simulator has no accelerometer, so its photos stay portrait.
      return;
    }
    return () => device.stopOrientationUpdates();
  }, [device, active]);
  return useCallback(async () => {
    // Flat on its back the phone has no orientation, so the last one held stays.
    const orientation = device.currentOrientation ?? "up";
    // oxlint-disable-next-line react/immutability -- VisionCamera outputs take their orientation through a native setter.
    output.outputOrientation = orientation;
    const { filePath } = await output.capturePhotoToFile({}, {});
    return { filePath, turns: PHOTO_TURNS[orientation] };
  }, [device, output]);
}
