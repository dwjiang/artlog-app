import type { DocentSentence, FactSheetEntry } from "../../convex/lib/validators";

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
export const openingFixture = "This is Water Lilies, by Claude Monet, dated 1916.";
export const guideBodyFixture: DocentSentence[] = [
  {
    sentence:
      "Start with the lilies resting on the surface of the pond, and give yourself a moment to follow the spaces between them.",
    factIds: ["f1"],
  },
  {
    sentence:
      "The garden appears here twice: in the plants themselves and in their reflections across the water.",
    factIds: ["f1"],
  },
  {
    sentence:
      "Notice that there is no horizon to separate the water from the scene reflected in it.",
    factIds: ["f1"],
  },
  {
    sentence: "That is a useful detail to keep in mind as your eye moves around the painting.",
    factIds: ["f1"],
  },
  {
    sentence:
      "The artist returned to this garden repeatedly, studying how its appearance changed with the light.",
    factIds: ["f2"],
  },
  {
    sentence:
      "So this view belongs to a continuing investigation of a familiar place, seen again at different moments.",
    factIds: ["f2"],
  },
  {
    sentence:
      "Look closely at the visible strokes of oil paint that make up the surface of the picture.",
    factIds: ["f2"],
  },
  {
    sentence:
      "You can follow those individual marks before stepping back and looking at the pond as a whole again.",
    factIds: ["f2"],
  },
  {
    sentence:
      "As you look, move between the flowers on the water and the reflections of the garden around them.",
    factIds: ["f1"],
  },
  {
    sentence:
      "Take another moment with that meeting of the pond and its reflected surroundings before you move on.",
    factIds: ["f1"],
  },
];
export const guideFixture: DocentSentence[] = [
  { sentence: openingFixture, factIds: [] },
  ...guideBodyFixture,
];
