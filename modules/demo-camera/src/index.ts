import { requireNativeView } from "expo";
import type { Ref } from "react";
import type { NativeSyntheticEvent, ViewProps } from "react-native";

import type { RectDetection } from "../../vision-rect/src";

export type DemoCameraHandle = {
  /** Saves the frame on screen as a JPEG and resolves with its file path. */
  takePhoto(): Promise<string>;
  /** Plays from `from` to `to` seconds, then loops back or holds the last frame. */
  play(from: number, to: number, loop: boolean): Promise<void>;
};

export type DemoCameraProps = ViewProps & {
  /** File URI of the video. */
  source: string;
  /** Plays and detects only while active; paused, it holds its frame like a stopped camera. */
  active: boolean;
  /** Frames between rectangle detections. */
  detectionStride: number;
  onReady?: () => void;
  onDetection?: (event: NativeSyntheticEvent<RectDetection>) => void;
  onError?: (event: NativeSyntheticEvent<{ message: string }>) => void;
  ref?: Ref<DemoCameraHandle>;
};

/** A video standing in for the camera preview, with rectangle detection on its frames. */
export const DemoCamera = requireNativeView<DemoCameraProps>("DemoCamera");
