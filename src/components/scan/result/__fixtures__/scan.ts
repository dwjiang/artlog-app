import type { Id } from "../../../../../convex/_generated/dataModel";
import type { ResultCandidate, ScanResult } from "@/lib/result/state";

export const SCAN_ID = "scan-1" as Id<"scans">;

export const lilies: ResultCandidate = {
  identityStatus: "established" as const,
  objectId: "obj-lilies" as Id<"objects">,
  artworkId: "art-lilies" as Id<"artworks">,
  probability: 0.97,
  title: "Water Lilies",
  artist: "Claude Monet",
  date: "1916",
  medium: "Oil on canvas",
  institution: "Metropolitan Museum of Art",
  rightsStatus: "public_domain",
  gallery: "Gallery 819",
};

export const bridge: ResultCandidate = {
  identityStatus: "established" as const,
  objectId: "obj-bridge" as Id<"objects">,
  artworkId: "art-bridge" as Id<"artworks">,
  probability: 0.31,
  title: "The Japanese Footbridge",
  artist: "Claude Monet",
  date: "1899",
  medium: "Oil on canvas",
  institution: "National Gallery of Art",
  rightsStatus: "public_domain",
  thumbnailUrl: "https://images.example/bridge.jpg",
};

export const haystacks: ResultCandidate = {
  identityStatus: "established" as const,
  objectId: "obj-haystacks" as Id<"objects">,
  artworkId: "art-haystacks" as Id<"artworks">,
  probability: 0.12,
  title: "Haystacks",
  artist: "Claude Monet",
  institution: "Art Institute of Chicago",
  rightsStatus: "in_copyright",
};

export const docent = [
  { sentence: "Monet painted this pond at Giverny in 1916.", factIds: ["f1"] },
  { sentence: "It entered the collection in 1959.", factIds: ["f2"] },
];
export const factSheet = [
  {
    id: "f1",
    sourceUrl: "https://www.wikidata.org/wiki/Q1",
    sourceLabel: "Wikidata",
  },
  {
    id: "f2",
    sourceUrl: "https://www.metmuseum.org/art/collection/search/1",
    sourceLabel: "The Met",
  },
];
export const rightNow = {
  text: "Monet’s late water lilies are on view at the Met through January.",
  sourceUrl: "https://news.example/monet",
  sourceLabel: "Example News",
};

const base = {
  scanId: SCAN_ID,
  localId: "capture-1",
  capturedAt: 1_700_000_000_000,
  calibratorVersion: "v1",
  venueId: "museum-met" as Id<"museums">,
  visitId: "visit-remote-1" as Id<"visits">,
} as const;

export const confidentScan: NonNullable<ScanResult> = {
  ...base,
  status: "identified",
  outcome: "confident",
  best: lilies,
  runnerUps: [bridge, haystacks],
  docent,
  factSheet,
  rightNow,
};

export const confidentScanWithoutProse: NonNullable<ScanResult> = {
  ...base,
  status: "identified",
  outcome: "confident",
  best: lilies,
  runnerUps: [bridge],
};

export const softScan: NonNullable<ScanResult> = {
  ...base,
  status: "identified",
  outcome: "soft",
  best: { ...bridge, probability: 0.62 },
  runnerUps: [haystacks],
};

export const missScan: NonNullable<ScanResult> = {
  ...base,
  status: "identified",
  outcome: "miss",
  best: { ...haystacks, probability: 0.2 },
  runnerUps: [bridge],
};

export const pendingScan: NonNullable<ScanResult> = {
  ...base,
  status: "pending",
  runnerUps: [],
};
export const unsupportedScan: NonNullable<ScanResult> = {
  ...base,
  status: "unsupported_version",
  runnerUps: [],
  error: "Update the app to identify.",
};
export const failedScan: NonNullable<ScanResult> = {
  ...base,
  status: "failed",
  runnerUps: [],
  error: "bad_features",
};
