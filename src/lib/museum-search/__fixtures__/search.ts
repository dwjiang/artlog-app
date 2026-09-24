import type {
  LabelFlowDisplay,
  MuseumSearchDisplay,
  SearchCandidate,
} from "../../../../convex/lib/validators";

export const candidate: SearchCandidate = {
  sourceUrl: "https://museum.example/exhibitions/colour",
  exhibition: {
    title: "A Century of Colour",
    content: "Paintings from the collection.",
  },
  imageUrls: [
    "https://museum.example/blue.jpg",
    "https://museum.example/blue-detail.jpg",
  ],
};
export const exhibitionCandidates: MuseumSearchDisplay = {
  stage: "exhibitions",
  candidates: [candidate],
  updatedAt: 1,
};
export const verified: LabelFlowDisplay = {
  stage: "verified",
  moderation: "clear",
  warnings: [],
  evidence: ["tavily+image"],
  updatedAt: 2,
  sourceUrl: candidate.sourceUrl,
  identityImageUrl: candidate.imageUrls[0],
  fields: {
    title: { value: "Blue painting", evidence: "tavily+image", locked: true },
    artist: { value: "A. Painter", evidence: "tavily+image", locked: true },
  },
};
export const confirmed: MuseumSearchDisplay = {
  stage: "confirmed",
  candidates: [candidate],
  selected: {
    sourceUrl: candidate.sourceUrl,
    imageUrl: candidate.imageUrls[0],
  },
  updatedAt: 2,
};
