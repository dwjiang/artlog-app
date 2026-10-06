import type { GuideSection, GuideSentence } from "../../../convex/lib/validators";

export const GUIDE_SECTION_TITLES: Record<GuideSection, string> = {
  hook: "Opening",
  look: "Look closer",
  story: "The story",
  takeaway: "Takeaway",
};

// Speech arrives without timings, so a sentence starts after its predecessors' share of the spoken text,
// with a pause after each spoken stop. Fit on 2026-10-05 to the pauses in a 75.8 s Water Lilies render:
// every estimated start landed within 1.2 s of the real one.
const PAUSE_WEIGHT = 14;
// The same render's pace in characters (pauses included) per second, for a live guide whose length is still unknown.
const WEIGHT_PER_SECOND = 16.2;
const SPOKEN_STOP = /[.!?…]+["'”’)]*(?=\s|$)/g;

export type GuideTimeline = {
  /** Estimated start of each sentence, in seconds. */
  starts: number[];
  /** The length the starts are spread over: the audio's, or an estimate while it is unknown. */
  length: number;
  sections: { section: GuideSection; title: string; sentence: number; start: number; end: number }[];
};

export function guideTimeline(sentences: GuideSentence[], duration?: number): GuideTimeline {
  const weights = sentences.map(
    ({ sentence }) => sentence.length + PAUSE_WEIGHT * Math.max(1, sentence.match(SPOKEN_STOP)?.length ?? 0),
  );
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const length = duration && duration > 0 ? duration : total / WEIGHT_PER_SECOND;
  let spoken = 0;
  const starts = weights.map((weight) => {
    const start = total > 0 ? (spoken / total) * length : 0;
    spoken += weight;
    return start;
  });
  const sections: GuideTimeline["sections"] = [];
  sentences.forEach(({ section }, index) => {
    const last = sections.at(-1);
    if (last?.section === section) return;
    if (last) last.end = starts[index];
    sections.push({
      section,
      title: GUIDE_SECTION_TITLES[section],
      sentence: index,
      start: starts[index],
      end: length,
    });
  });
  return { starts, length, sections };
}

/** The sentence being spoken at a position: the last one already started, or the first before any has. */
export function sentenceAt({ starts }: GuideTimeline, position: number) {
  let index = 0;
  while (index + 1 < starts.length && starts[index + 1] <= position) index++;
  return index;
}
