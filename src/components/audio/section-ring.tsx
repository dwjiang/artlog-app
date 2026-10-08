import { Canvas, Path } from "@shopify/react-native-skia";
import { type SharedValue, useDerivedValue } from "react-native-reanimated";

import { Gallery } from "@/constants/theme";
import { useSteadyValue } from "@/hooks/use-steady-value";
import { guideParts, type GuideTimeline } from "@/lib/audio/guide-timeline";
import { PLAYBACK_UPDATE_MS } from "@/lib/audio/narration";
import { useGeneratedRange } from "@/lib/audio/use-generated-range";

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
  const played = useSteadyValue(position, PLAYBACK_UPDATE_MS);
  const radius = (size - STROKE) / 2;
  const center = size / 2;
  // One clockwise turn from twelve o'clock; trimming it by length draws the arc between any two fractions.
  const circle = `M ${center} ${center - radius} A ${radius} ${radius} 0 1 1 ${center} ${center + radius} A ${radius} ${radius} 0 1 1 ${center} ${center - radius}`;
  const parts = guideParts(timeline, scale);
  const length = parts[parts.length - 1].end;
  const generated = useGeneratedRange(available, length);
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
              generated={generated}
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
  generated,
  length,
}: {
  circle: string;
  from: number;
  to: number;
  played: SharedValue<number>;
  generated: SharedValue<number>;
  length: number;
}) {
  const playedEnd = useDerivedValue(() => Math.min(to, Math.max(from, played.get() / length)));
  const generatedEnd = useDerivedValue(() => Math.min(to, Math.max(from, generated.get())));
  const arc = (end: number | SharedValue<number>, color: string) => (
    <Path path={circle} start={from} end={end} color={color} style="stroke" strokeWidth={STROKE} />
  );
  return (
    <>
      {arc(to, TRACK)}
      {arc(generatedEnd, Gallery.accentBorder)}
      {arc(playedEnd, Gallery.accent)}
    </>
  );
}
