import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { StyleSheet } from "react-native";

import { takeWalkRequest, WALK_REQUEST_POLL_MS, type DemoVideo } from "@/lib/capture/demo-viewfinder";
import { DETECTION_STRIDE } from "@/lib/capture/use-rect-detector";
import type { UprightPhoto } from "@/lib/capture/use-upright-photo";

import { DemoCamera, type DemoCameraHandle } from "../../../modules/demo-camera/src";
import type { RectDetection } from "../../../modules/vision-rect/src";

export type DemoViewfinderHandle = { takePhoto(): Promise<UprightPhoto> };

type Props = {
  video: DemoVideo;
  active: boolean;
  /** The scan is looking for an artwork, so a painting picked on the demo page is walked up to now. */
  searching: boolean;
  /** Whether a painting is picked; standing back, the wall's paintings are too far away to scan. */
  onTargetChange: (targeted: boolean) => void;
  onReady: () => void;
  onDetection: (detection: RectDetection) => void;
  onError: (message: string) => void;
  ref: Ref<DemoViewfinderHandle>;
};

/**
 * Stands in for the camera preview in the judges' demo build: a phone's view of a gallery wall. It stands back from the
 * wall until the demo page picks a painting, then plays that painting's walk, whose frames go through the same
 * rectangle detection, steadiness check and capture as camera frames. After a capture it stands back again.
 */
export function DemoViewfinder({
  video,
  active,
  searching,
  onTargetChange,
  onReady,
  onDetection,
  onError,
  ref,
}: Props) {
  const camera = useRef<DemoCameraHandle>(null);
  const [ready, setReady] = useState(false);
  const [target, setTarget] = useState<number>();
  const captured = useRef(false);
  const walk = target === undefined ? undefined : video.walks[target];
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
    setTarget(undefined);
    onTargetChange(false);
  }, [active, onTargetChange]);
  // A pick made while the scan is busy or another tab is open waits until the viewfinder is searching again.
  useEffect(() => {
    if (!searching) return;
    const timer = setInterval(() => {
      const painting = takeWalkRequest(video.walks.length);
      if (painting === undefined) return;
      setTarget(painting);
      onTargetChange(true);
    }, WALK_REQUEST_POLL_MS);
    return () => clearInterval(timer);
  }, [searching, video.walks.length, onTargetChange]);

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
