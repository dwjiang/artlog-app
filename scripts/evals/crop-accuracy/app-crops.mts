// The app's crop choice and match snap for the eval, from the repository's own source. Run from the repository root:
//   npx tsx scripts/evals/crop-accuracy/app-crops.mts select < analysis.jsonl   (harness `analyze` lines)
//   npx tsx scripts/evals/crop-accuracy/app-crops.mts snap < crops.jsonl        (lines written by crops.py)
import { createInterface } from "node:readline";

import model from "../../../shared/model/model-version.json";
import { decodeOrbFeatures } from "../../../shared/orb/features";
import { verifyOrb } from "../../../shared/orb/verify";
import { containsPoint, cropQuads, isUsableQuad, quadArea, toQuad } from "../../../src/lib/capture/rectangle";
import { snapToReference } from "../../../src/lib/capture/snap-crop";
import type { Quad } from "../../../src/lib/capture/stages";

type Point = [number, number];
type Analysis = {
  file: string;
  width: number;
  height: number;
  rectangles: { confidence: number; area: number; corners: Point[] }[];
  subjects: { area: number; quadFill: number; bounds: Point[]; quad: Point[] }[];
};

const corners = (points: Point[]) => points.map(([x, y]) => ({ x, y }));
const bytes = (base64: string) => {
  const buffer = Buffer.from(base64, "base64");
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
};

function select(analysis: Analysis) {
  const still = {
    width: analysis.width,
    height: analysis.height,
    subjectNote: null,
    rectangles: analysis.rectangles.map((r) => ({ ...r, corners: corners(r.corners) })),
    subjects: analysis.subjects.map((s) => ({ ...s, bounds: corners(s.bounds), quad: corners(s.quad) })),
  };
  const rows: { photo: string; method: string; quad: Quad | null }[] = [
    // Shutter without a tracked outline, steady capture and photo imports.
    { photo: analysis.file, method: "unguided", quad: cropQuads(null, still, false)[0] ?? null },
  ];
  // Auto-capture locks onto the outermost rectangle around where the phone is aimed.
  const aimed = still.rectangles
    .map((r) => toQuad(r.corners))
    .filter((quad) => isUsableQuad(quad) && containsPoint(quad, [0.5, 0.5]))
    .sort((a, b) => quadArea(b) - quadArea(a))[0];
  if (aimed) rows.push({ photo: analysis.file, method: "auto", quad: cropQuads(aimed, still, false)[0] ?? null });
  return rows;
}

type CropRow = {
  photo: string;
  method: string;
  cropCorners: Quad;
  contentBounds: { x: number; y: number; width: number; height: number };
  referenceSize: { width: number; height: number };
  query: { descriptors: string; keypoints: string };
  reference: { descriptors: string; keypoints: string };
};

function snap(row: CropRow) {
  const decode = (features: CropRow["query"]) =>
    decodeOrbFeatures(bytes(features.descriptors), bytes(features.keypoints));
  const verification = verifyOrb(decode(row.query), decode(row.reference), { inputSize: model.inputSize });
  const quad =
    verification.verified && verification.corners
      ? snapToReference({
          referenceCorners: verification.corners,
          referenceSize: row.referenceSize,
          cropCorners: row.cropCorners,
          contentBounds: row.contentBounds,
          inputSize: model.inputSize,
        })
      : null;
  return {
    photo: row.photo,
    method: row.method,
    inliers: verification.inlierCount,
    verified: verification.verified,
    quad,
  };
}

const mode = process.argv[2];
if (mode !== "select" && mode !== "snap") throw new Error("usage: app-crops.mts select|snap < lines");
for await (const line of createInterface({ input: process.stdin })) {
  if (!line.trim()) continue;
  const input = JSON.parse(line);
  for (const row of mode === "select" ? select(input) : [snap(input)]) console.log(JSON.stringify(row));
}
