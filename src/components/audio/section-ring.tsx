import { Canvas, Path } from "@shopify/react-native-skia";
import { useEffect } from "react";
import {
  cancelAnimation,
  Easing,
  type SharedValue,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { Gallery } from "@/constants/theme";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { guideParts, type GuideTimeline } from "@/lib/audio/guide-timeline";
import { PLAYBACK_UPDATE_MS } from "@/lib/audio/narration";

const STROKE = 2.5;
const GAP = 3;
// Skia takes no platform colors; a translucent gray stays visible whether the accessory's glass renders light or dark.
const TRACK = "rgba(120, 120, 128, 0.32)";

/** Narration progress drawn around the play button, cut into the guide's sections like the player's section bar. */
export function SectionRing({
  size,
  timeline,
  scale,
  position,
  available,
}: {
  size: number;
  timeline?: GuideTimeline;
  scale: number;
  position: number;
  available: number;
}) {
  const reduced = useReducedMotion();
  const played = useSharedValue(position);
  // Positions arrive once per playback update; easing to each over that same interval keeps the ring sweeping steadily.
  useEffect(() => {
    played.set(withTiming(position, { duration: reduced ? 0 : PLAYBACK_UPDATE_MS, easing: Easing.linear }));
    return () => cancelAnimation(played);
  }, [played, position, reduced]);
  const radius = (size - STROKE) / 2;
  const center = size / 2;
  // One clockwise turn from twelve o'clock; trimming it by length draws the arc between any two fractions.
  const circle = `M ${center} ${center - radius} A ${radius} ${radius} 0 1 1 ${center} ${center + radius} A ${radius} ${radius} 0 1 1 ${center} ${center - radius}`;
  const parts = guideParts(timeline, scale);
  const length = parts[parts.length - 1].end;
  const gap = parts.length > 1 ? GAP / (2 * Math.PI * radius) : 0;
  return (
    <Canvas style={{ width: size, height: size }}>
      {parts.map(({ start, end }) => {
        const from = start / length + gap / 2;
        const to = end / length - gap / 2;
        return (
          to > from && (
            <SectionArc
              key={start}
              circle={circle}
              from={from}
              to={to}
              played={played}
              available={available / length}
              length={length}
            />
          )
        );
      })}
    </Canvas>
  );
}

function SectionArc({
  circle,
  from,
  to,
  played,
  available,
  length,
}: {
  circle: string;
  from: number;
  to: number;
  played: SharedValue<number>;
  available: number;
  length: number;
}) {
  const playedEnd = useDerivedValue(() => Math.min(to, Math.max(from, played.get() / length)));
  const arc = (end: number | SharedValue<number>, color: string) => (
    <Path path={circle} start={from} end={end} color={color} style="stroke" strokeWidth={STROKE} />
  );
  return (
    <>
      {arc(to, TRACK)}
      {available > 0 && arc(Math.min(to, Math.max(from, available)), Gallery.accentBorder)}
      {arc(playedEnd, Gallery.accent)}
    </>
  );
}
