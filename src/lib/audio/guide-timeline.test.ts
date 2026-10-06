import type { GuideSection, GuideSentence } from "../../../convex/lib/validators";
import { guideTimeline, sentenceAt } from "./guide-timeline";

const line = (sentence: string, section: GuideSection = "story"): GuideSentence => ({
  sentence,
  factIds: [],
  section,
});

// A real 75.8 s Water Lilies render (2026-10-05), with each sentence's start read from the pauses in its audio.
const waterLilies = [
  line("Claude Monet. Water Lilies. Dated 1906.", "hook"),
  line("Monet called these water lily paintings an obsession, and the canvas shows why.", "hook"),
  line("Clusters of lilies anchor bottom left and top right, framing a watery path between them.", "look"),
  line("The surface mirrors trees and clouds, with no horizon line to ground you.", "look"),
  line("Step closer and the blue dissolves into countless mixed tones, not one flat color.", "look"),
  line("He mixed French ultramarine and cobalt blue on the brush itself, swirling them wet on wet."),
  line("Viridian green appears pure in dark foliage, then blended with synthetic malachite for lighter leaves."),
  line("Cobalt violet stains the water's shadows purple, then jumps straight from the tube onto lily flowers."),
  line("Technical exams reveal he reworked the surface repeatedly, building thick impasto and layered glazes."),
  line("He embraced new chemical pigments to freeze light, color, and reflection on his pond at Giverny."),
  line("This square canvas marks his turn from landscape to pure surface, painted between 1903 and 1908.", "takeaway"),
  line("Every purple accent and blue swirl is a choice he made tube by tube, stroke by stroke.", "takeaway"),
];
const spokenStarts = [0, 5.16, 11.24, 17.42, 22.56, 28.72, 34.96, 41.42, 47.84, 55.08, 61.86, 69.76];

it("places every sentence of a finished render within about a second of where it is spoken", () => {
  const { starts, length } = guideTimeline(waterLilies, 75.77);
  expect(length).toBe(75.77);
  starts.forEach((start, index) => expect(Math.abs(start - spokenStarts[index])).toBeLessThan(1.25));
});

it("estimates a live guide's length from the voice's pace until the real length arrives", () => {
  const live = guideTimeline(waterLilies);
  expect(Math.abs(live.length - 75.77)).toBeLessThan(2);
  expect(guideTimeline(waterLilies, 0).length).toBe(live.length);
  expect(guideTimeline(waterLilies, 80).length).toBe(80);
});

it("gives a sentence with several spoken stops the pauses between them", () => {
  const label = guideTimeline([line("Ann Lee. Tide. Dated 1901.", "hook"), line("Short.")], 10);
  const prose = guideTimeline([line("Ann Lee painted Tide in 1901.", "hook"), line("Short.")], 10);
  expect(label.starts[1]).toBeGreaterThan(prose.starts[1]);
});

it("groups the guide into its sections, each running until the next one starts", () => {
  const { sections, starts, length } = guideTimeline(waterLilies, 75.77);
  expect(sections.map(({ section, title, sentence }) => [section, title, sentence])).toEqual([
    ["hook", "Opening", 0],
    ["look", "Look closer", 2],
    ["story", "The story", 5],
    ["takeaway", "Takeaway", 10],
  ]);
  expect(sections.map(({ start, end }) => [start, end])).toEqual([
    [0, starts[2]],
    [starts[2], starts[5]],
    [starts[5], starts[10]],
    [starts[10], length],
  ]);
});

it("finds the sentence being spoken, holding the first before it starts and the last after it ends", () => {
  const timeline = guideTimeline(waterLilies, 75.77);
  expect(sentenceAt(timeline, -1)).toBe(0);
  expect(sentenceAt(timeline, 0)).toBe(0);
  expect(sentenceAt(timeline, timeline.starts[6])).toBe(6);
  expect(sentenceAt(timeline, timeline.starts[6] - 0.01)).toBe(5);
  expect(sentenceAt(timeline, 500)).toBe(11);
});
