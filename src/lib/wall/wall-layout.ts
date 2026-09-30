import { DEFAULT_WALL_FRAME } from "@/shared/wall/defaults";

import { wallFrameInset } from "./wall-frames";
import type { LayoutInput, OwnerWall } from "./wall-transport";

export type WallDraft = Pick<LayoutInput, "color" | "pattern" | "items">;
export type Wallpaper = Pick<WallDraft, "color" | "pattern">;
export type WallPattern = NonNullable<Wallpaper["pattern"]>;
export type WallLayout = LayoutInput["items"][number]["layout"];
export type WallFrame = WallLayout["frame"];
export type WallCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
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

function wallOverlap(bounds: ReturnType<typeof wallPieceBounds>, other: ReturnType<typeof wallPieceBounds>) {
  "worklet";
  // Separation distances keep small escape steps effective even when one artwork contains the other.
  const x = Math.max(0, Math.min(bounds.x + bounds.width + 0.025 - other.x, other.x + other.width + 0.025 - bounds.x));
  const y = Math.max(0, Math.min(bounds.y + bounds.height + 0.16 - other.y, other.y + other.height + 0.16 - bounds.y));
  return x * y;
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
    ({ layout }) => placement.x < layout.x + layout.width + 0.025 && placement.x + placement.width + 0.025 > layout.x,
  );
  return {
    ...placement,
    y: neighbors.length > 0 ? wallBottom(neighbors, wallWidth) + 0.16 : index % 2 ? 0.12 : 0.06,
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
