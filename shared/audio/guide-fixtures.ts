import type { FactSheetEntry, GuideSentence } from "../../convex/lib/validators";

export const researchFixture: FactSheetEntry[] = [
  {
    id: "f1",
    text: "The painting shows water lilies and reflections of the garden on the pond, without a horizon.",
    sourceUrl: "https://museum.example/work",
    sourceLabel: "Museum",
    sourceScore: 1,
  },
  {
    id: "f2",
    text: "The artist painted the garden repeatedly to study changing light, using visible strokes of oil paint.",
    sourceUrl: "https://museum.example/work",
    sourceLabel: "Museum",
    sourceScore: 1,
  },
];
export const openingFixture = "Claude Monet. Water Lilies. Dated 1916.";
export const guideBodyFixture: GuideSentence[] = [
  {
    sentence:
      "Start with the lilies resting on the surface of the pond, and give yourself a moment to follow the spaces between them.",
    factIds: ["f1"],
    section: "hook",
  },
  {
    sentence: "The garden appears here twice: in the plants themselves and in their reflections across the water.",
    factIds: ["f1"],
    section: "look",
  },
  {
    sentence: "Notice that there is no horizon to separate the water from the scene reflected in it.",
    factIds: ["f1"],
    section: "look",
  },
  {
    sentence: "That is a useful detail to keep in mind as your eye moves around the painting.",
    factIds: ["f1"],
    section: "story",
  },
  {
    sentence: "The artist returned to this garden repeatedly, studying how its appearance changed with the light.",
    factIds: ["f2"],
    section: "story",
  },
  {
    sentence:
      "So this view belongs to a continuing investigation of a familiar place, seen again at different moments.",
    factIds: ["f2"],
    section: "story",
  },
  {
    sentence: "Look closely at the visible strokes of oil paint that make up the surface of the picture.",
    factIds: ["f2"],
    section: "story",
  },
  {
    sentence: "You can follow those individual marks before stepping back and looking at the pond as a whole again.",
    factIds: ["f2"],
    section: "story",
  },
  {
    sentence: "As you look, move between the flowers on the water and the reflections of the garden around them.",
    factIds: ["f1"],
    section: "story",
  },
  {
    sentence: "Take another moment with that meeting of the pond and its reflected surroundings before you move on.",
    factIds: ["f1"],
    section: "takeaway",
  },
];
export const guideFixture: GuideSentence[] = [
  { sentence: openingFixture, factIds: [], section: "hook" },
  ...guideBodyFixture,
];
// The guide model answers in sections; tests write a flat script and lay it out the way the schema asks.
export const sectionedGuide = <T>(lines: T[]) => ({
  hook: lines.slice(0, 1),
  look: lines.slice(1, 3),
  story: lines.slice(3, 9),
  takeaway: lines.slice(9),
});
