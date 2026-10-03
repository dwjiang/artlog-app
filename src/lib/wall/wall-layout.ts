import { DEFAULT_WALL_FRAME } from "@/shared/wall/defaults";
import { wallFrameInset } from "@/shared/wall/frames";

import type { LayoutInput, OwnerWall } from "./wall-transport";

export type WallDraft = Pick<LayoutInput, "color" | "pattern" | "items">;
export type Wallpaper = Pick<WallDraft, "color" | "pattern">;
export type WallPattern = NonNullable<Wallpaper["pattern"]>;
export type WallLayout = LayoutInput["items"][number]["layout"];
export type WallFrame = WallLayout["frame"];
export type WallCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
export type WallArrangement = Record<string, WallLayout>;
export type WallPiece = {
  localId: string;
  saveLocalId?: string;
  photoLocalId?: string;
  artwork: OwnerWall["items"][number]["artwork"];
  layout: WallLayout;
  cropPath?: string | null;
  cropAspectRatio?: number;
};

export function wallAspect(piece: Pick<WallPiece, "artwork" | "cropAspectRatio">): number {
  "worklet";
  if (piece.cropAspectRatio && Number.isFinite(piece.cropAspectRatio) && piece.cropAspectRatio > 0) {
    return piece.cropAspectRatio;
  }
  const { width, height } = piece.artwork.media;
  return width > 0 && height > 0 ? width / height : 1;
}

export function wallPieceBounds(piece: WallPiece, wallWidth: number) {
  "worklet";
  const { x, y, width, frame } = piece.layout;
  const inset = wallFrameInset(frame, width * wallWidth) / wallWidth;
  return { x, y, width, height: (width - inset * 2) / wallAspect(piece) + inset * 2 };
}

export function wallBottom(pieces: WallPiece[], wallWidth = 390): number {
  return Math.max(
    0,
    ...pieces.map((piece) => {
      const bounds = wallPieceBounds(piece, wallWidth);
      return bounds.y + bounds.height;
    }),
  );
}

export function constrainLayout(layout: WallLayout, patch: Partial<WallLayout>): WallLayout {
  "worklet";
  const next = { ...layout, ...patch };
  const width = Math.min(0.9, Math.max(0.16, next.width));
  return {
    ...next,
    width,
    x: Math.max(0.025, Math.min(0.975 - width, next.x)),
    y: Math.max(0.04, Math.min(99, next.y)),
  };
}

const SIDE_GAP = 0.025;
// Each artwork's label hangs below it.
const LABEL_GAP = 0.16;

type WallBounds = ReturnType<typeof wallPieceBounds>;

function wallSeparation(bounds: WallBounds, other: WallBounds) {
  "worklet";
  return {
    x: Math.max(0, Math.min(bounds.x + bounds.width + SIDE_GAP - other.x, other.x + other.width + SIDE_GAP - bounds.x)),
    y: Math.max(
      0,
      Math.min(bounds.y + bounds.height + LABEL_GAP - other.y, other.y + other.height + LABEL_GAP - bounds.y),
    ),
  };
}

function wallOverlap(bounds: WallBounds, other: WallBounds) {
  "worklet";
  // Separation distances keep small escape steps effective even when one artwork contains the other.
  const { x, y } = wallSeparation(bounds, other);
  return x * y;
}

function wallClash(bounds: WallBounds, other: WallBounds) {
  "worklet";
  // Artworks placed exactly a gap apart must not clash through rounding.
  const { x, y } = wallSeparation(bounds, other);
  return x > 1e-6 && y > 1e-6;
}

export function constrainWallPiece(
  piece: WallPiece,
  patch: Partial<WallLayout>,
  pieces: WallPiece[],
  wallWidth: number,
): WallLayout {
  "worklet";
  const next = constrainLayout(piece.layout, patch);
  const neighbors = pieces
    .filter((other) => other.localId !== piece.localId)
    .map((other) => wallPieceBounds(other, wallWidth));
  const currentBounds = wallPieceBounds(piece, wallWidth);
  const currentOverlaps = neighbors.map((other) => wallOverlap(currentBounds, other));
  const worsensOverlap = (layout: WallLayout) => {
    const bounds = wallPieceBounds({ ...piece, layout }, wallWidth);
    return neighbors.some((other, index) => wallOverlap(bounds, other) > currentOverlaps[index]);
  };
  if (!worsensOverlap(next)) return next;
  // Find the last allowed point along the attempted move or resize, keeping its anchor intact.
  let low = 0;
  let high = 1;
  let clear = piece.layout;
  for (let step = 0; step < 16; step++) {
    const fraction = (low + high) / 2;
    const candidate = {
      ...next,
      x: piece.layout.x + (next.x - piece.layout.x) * fraction,
      y: piece.layout.y + (next.y - piece.layout.y) * fraction,
      width: piece.layout.width + (next.width - piece.layout.width) * fraction,
    };
    if (worsensOverlap(candidate)) {
      high = fraction;
    } else {
      low = fraction;
      clear = candidate;
    }
  }
  return clear;
}

function clearWallLayout(piece: WallPiece, settled: WallBounds[], unsettled: WallBounds[], wallWidth: number) {
  "worklet";
  const start = wallPieceBounds(piece, wallWidth);
  let best = piece.layout;
  let bestCost = Infinity;
  for (const other of settled) {
    if (!wallClash(start, other)) continue;
    for (const candidate of [
      { x: other.x - SIDE_GAP - start.width, y: start.y },
      { x: other.x + other.width + SIDE_GAP, y: start.y },
      { x: start.x, y: other.y - LABEL_GAP - start.height },
      { x: start.x, y: other.y + other.height + LABEL_GAP },
    ]) {
      const layout = constrainLayout(piece.layout, candidate);
      const bounds = { ...start, x: layout.x, y: layout.y };
      if (settled.some((item) => wallClash(bounds, item))) continue;
      // Displacing one more artwork costs as much as moving a full wall width.
      const cost =
        Math.hypot(layout.x - start.x, layout.y - start.y)
        + (unsettled.some((item) => wallClash(bounds, item)) ? 1 : 0);
      if (cost < bestCost) {
        best = layout;
        bestCost = cost;
      }
    }
  }
  if (bestCost < Infinity) return best;
  // The wall always has room below the artworks in the way.
  let { y } = start;
  for (;;) {
    const bounds = { ...start, y };
    const blockers = settled.filter((other) => wallClash(bounds, other));
    if (blockers.length === 0) return constrainLayout(piece.layout, { y });
    y = Math.max(...blockers.map((other) => other.y + other.height + LABEL_GAP));
  }
}

/**
 * Hangs the placed artworks in order, each moving only as far as the ones before it require, then moves every other
 * artwork they would overlap to its nearest clear spot.
 */
export function arrangeWall(pieces: WallPiece[], placed: WallArrangement, wallWidth: number): WallArrangement {
  "worklet";
  const arrangement: WallArrangement = {};
  const settled: WallBounds[] = [];
  const waiting = pieces
    .filter((piece) => !placed[piece.localId])
    .sort((a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x);
  const settle = (piece: WallPiece) => {
    const bounds = wallPieceBounds(piece, wallWidth);
    let { layout } = piece;
    if (settled.some((other) => wallClash(bounds, other))) {
      const unsettled = waiting
        .filter((other) => other !== piece && !arrangement[other.localId])
        .map((other) => wallPieceBounds(other, wallWidth));
      layout = clearWallLayout(piece, settled, unsettled, wallWidth);
    }
    arrangement[piece.localId] = layout;
    settled.push(wallPieceBounds({ ...piece, layout }, wallWidth));
  };
  for (const id of Object.keys(placed)) {
    const piece = pieces.find((item) => item.localId === id);
    if (piece) settle({ ...piece, layout: placed[id] });
  }
  // Each artwork moves at most once, so the cascade ends.
  let moved = true;
  while (moved) {
    moved = false;
    for (const piece of waiting) {
      const bounds = wallPieceBounds(piece, wallWidth);
      if (arrangement[piece.localId] || !settled.some((other) => wallClash(bounds, other))) continue;
      settle(piece);
      moved = true;
    }
  }
  return arrangement;
}

/**
 * Where artworks hang after one is dropped: onto another artwork, the two trade places and sizes; elsewhere, the
 * dropped artwork stays where it lands. Either way, artworks in the way move aside.
 */
export function dropWallPiece(
  pieces: WallPiece[],
  id: string,
  position: Pick<WallLayout, "x" | "y">,
  wallWidth: number,
): WallArrangement {
  "worklet";
  const piece = pieces.find((item) => item.localId === id);
  if (!piece) return {};
  const bounds = wallPieceBounds(piece, wallWidth);
  const centerX = position.x + bounds.width / 2;
  const centerY = position.y + bounds.height / 2;
  let target: WallPiece | undefined;
  for (const other of pieces) {
    const slot = wallPieceBounds(other, wallWidth);
    if (
      other.localId !== id
      && centerX >= slot.x
      && centerX <= slot.x + slot.width
      && centerY >= slot.y
      && centerY <= slot.y + slot.height
    ) {
      target = other;
    }
  }
  if (!target) {
    const dropped = constrainLayout(piece.layout, { x: position.x, y: position.y });
    return arrangeWall(pieces, { [id]: dropped }, wallWidth);
  }
  return arrangeWall(
    pieces,
    {
      [id]: { ...piece.layout, x: target.layout.x, y: target.layout.y, width: target.layout.width },
      [target.localId]: { ...target.layout, x: piece.layout.x, y: piece.layout.y, width: piece.layout.width },
    },
    wallWidth,
  );
}

export function resizeWallLayout(
  layout: WallLayout,
  corner: WallCorner,
  translation: { x: number; y: number },
  aspect: number,
): WallLayout {
  "worklet";
  const left = corner.endsWith("left");
  const top = corner.startsWith("top");
  const anchorX = layout.x + (left ? layout.width : 0);
  const anchorY = layout.y + (top ? layout.width / aspect : 0);
  // Project the finger's movement onto the artwork's diagonal to preserve its proportions.
  const delta =
    ((left ? -translation.x : translation.x) + (top ? -translation.y : translation.y) / aspect)
    / (1 + 1 / (aspect * aspect));
  const maxWidth = Math.min(0.9, left ? anchorX - 0.025 : 0.975 - anchorX, top ? (anchorY - 0.04) * aspect : 0.9);
  const minWidth = Math.max(0.16, top ? (anchorY - 99) * aspect : 0.16);
  const width = Math.max(minWidth, Math.min(maxWidth, layout.width + delta));
  return {
    ...layout,
    width,
    x: left ? anchorX - width : anchorX,
    y: top ? anchorY - width / aspect : anchorY,
  };
}

export function nextWallLayout(pieces: WallPiece[], wallWidth = 390): WallLayout {
  const index = pieces.length;
  const placements = [
    { x: 0.05, width: 0.52 },
    { x: 0.62, width: 0.3 },
    { x: 0.05, width: 0.24 },
    { x: 0.34, width: 0.4 },
    { x: 0.78, width: 0.18 },
    { x: 0.05, width: 0.6 },
    { x: 0.7, width: 0.26 },
  ];
  const placement = placements[index % placements.length];
  const neighbors = pieces.filter(
    ({ layout }) =>
      placement.x < layout.x + layout.width + SIDE_GAP && placement.x + placement.width + SIDE_GAP > layout.x,
  );
  return {
    ...placement,
    y: neighbors.length > 0 ? wallBottom(neighbors, wallWidth) + LABEL_GAP : index % 2 ? 0.12 : 0.06,
    layer: index,
    frame: DEFAULT_WALL_FRAME,
  };
}

export function removeWallPiece(draft: WallDraft, localId: string): WallDraft {
  return {
    ...draft,
    items: draft.items
      .filter((item) => item.placementId !== localId)
      .map((item, layer) => ({ ...item, layout: { ...item.layout, layer } })),
  };
}

export function isLightWall(color: string): boolean {
  const rgb = parseInt(color.slice(1), 16);
  return (rgb >> 16) * 0.299 + ((rgb >> 8) & 255) * 0.587 + (rgb & 255) * 0.114 > 153;
}
