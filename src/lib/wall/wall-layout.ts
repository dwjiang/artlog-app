import { DEFAULT_WALL_FRAME } from '@/shared/wall/defaults';
import type { LayoutInput, OwnerWall } from './wall-transport';

export type WallDraft = Pick<LayoutInput, 'color' | 'items'>;
export type WallLayout = LayoutInput['items'][number]['layout'];
export type WallFrame = WallLayout['frame'];
export type WallPiece = {
  localId: string;
  saveLocalId?: string;
  photoLocalId?: string;
  artwork: OwnerWall['items'][number]['artwork'];
  layout: WallLayout;
  cropPath?: string | null;
  cropAspectRatio?: number;
};

export function wallAspect(piece: Pick<WallPiece, 'artwork' | 'cropAspectRatio'>): number {
  if (piece.cropAspectRatio && Number.isFinite(piece.cropAspectRatio) && piece.cropAspectRatio > 0) return piece.cropAspectRatio;
  const { width, height } = piece.artwork.media;
  return width > 0 && height > 0 ? width / height : 1;
}

export function wallBottom(pieces: WallPiece[]): number {
  return Math.max(0, ...pieces.map((piece) => piece.layout.y + piece.layout.width / wallAspect(piece)));
}

export function constrainLayout(layout: WallLayout, patch: Partial<WallLayout>): WallLayout {
  'worklet';
  const next = { ...layout, ...patch };
  const width = Math.min(0.9, Math.max(0.16, next.width));
  return { ...next, width, x: Math.max(0.025, Math.min(0.975 - width, next.x)),
    y: Math.max(0.04, Math.min(99, next.y)) };
}

export function nextWallLayout(pieces: WallPiece[]): WallLayout {
  const index = pieces.length;
  const placements = [
    { x: 0.05, width: 0.52 }, { x: 0.62, width: 0.30 },
    { x: 0.05, width: 0.24 }, { x: 0.34, width: 0.40 }, { x: 0.78, width: 0.18 },
    { x: 0.05, width: 0.60 }, { x: 0.70, width: 0.26 },
  ];
  const placement = placements[index % placements.length];
  const neighbors = pieces.filter(({ layout }) => placement.x < layout.x + layout.width + 0.025
    && placement.x + placement.width + 0.025 > layout.x);
  return { ...placement, y: neighbors.length ? wallBottom(neighbors) + 0.16 : index % 2 ? 0.12 : 0.06,
    layer: index, frame: DEFAULT_WALL_FRAME };
}

export function removeWallPiece(draft: WallDraft, localId: string): WallDraft {
  return { ...draft, items: draft.items.filter((item) => item.placementId !== localId)
    .map((item, layer) => ({ ...item, layout: { ...item.layout, layer } })) };
}

export function isLightWall(color: string): boolean {
  const rgb = parseInt(color.slice(1), 16);
  return ((rgb >> 16) * 0.299 + ((rgb >> 8) & 255) * 0.587 + (rgb & 255) * 0.114) > 153;
}
