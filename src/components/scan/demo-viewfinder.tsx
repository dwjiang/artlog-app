import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { StyleSheet } from "react-native";

import type { DemoVideo } from "@/lib/capture/demo-viewfinder";
import { DETECTION_STRIDE } from "@/lib/capture/use-rect-detector";
import type { UprightPhoto } from "@/lib/capture/use-upright-photo";

import { DemoCamera, type DemoCameraHandle } from "../../../modules/demo-camera/src";
import type { RectDetection } from "../../../modules/vision-rect/src";

export type DemoViewfinderHandle = { takePhoto(): Promise<UprightPhoto> };

type Props = {
  video: DemoVideo;
  /** The painting the phone walks up to; without one it stands back from the wall. */
  target: number | undefined;
  active: boolean;
  onReady: () => void;
  onDetection: (detection: RectDetection) => void;
  onError: (message: string) => void;
  /** The phone has stepped back from the painting it captured, now that the camera is active again. */
  onStepBack: () => void;
  ref: Ref<DemoViewfinderHandle>;
};

/**
 * Stands in for the camera preview in the judges' demo build: a phone's view of a gallery wall. Walking up to a
 * painting plays its part of the video, whose frames go through the same rectangle detection, steadiness check and
 * capture as camera frames; standing back, nothing is detected.
 */
export function DemoViewfinder({ video, target, active, onReady, onDetection, onError, onStepBack, ref }: Props) {
  const camera = useRef<DemoCameraHandle>(null);
  const [ready, setReady] = useState(false);
  const captured = useRef(false);
  const walk = target === undefined ? undefined : video.paintings[target]?.walk;
  const segment = walk ?? video.idle;
  useImperativeHandle(
    ref,
    () => ({
      takePhoto: async () => {
        const filePath = await camera.current!.takePhoto();
        captured.current = true;
        return { filePath, turns: 0 };
      },
    }),
    [],
  );
  useEffect(() => {
    if (ready) void camera.current?.play(segment.start, segment.end, !walk);
  }, [ready, segment.start, segment.end, walk]);
  useEffect(() => {
    if (!active || !captured.current) return;
    captured.current = false;
    onStepBack();
  }, [active, onStepBack]);

  return (
    <DemoCamera
      ref={camera}
      style={StyleSheet.absoluteFill}
      source={video.uri}
      active={active}
      detectionStride={DETECTION_STRIDE}
      onReady={() => {
        setReady(true);
        onReady();
      }}
      onDetection={({ nativeEvent }) => {
        if (walk) onDetection(nativeEvent);
      }}
      onError={({ nativeEvent }) => onError(nativeEvent.message)}
    />
  );
}
