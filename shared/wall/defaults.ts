// Persisted customization defaults stay independent of interface theme changes.
export const DEFAULT_WALL_COLOR = "#FCFCF9";
export const DEFAULT_WALL_FRAME = "black";
export const DEFAULT_THUMBNAIL_FRAME = "none";

export const WALL_COLORS = [
  { name: "Paper", value: DEFAULT_WALL_COLOR },
  { name: "Sage", value: "#CDD0CA" },
  { name: "Forest", value: "#45524B" },
  { name: "Slate", value: "#4C5B6B" },
  { name: "Burgundy", value: "#6C2F2B" },
  { name: "Plum", value: "#524650" },
  { name: "Limestone", value: "#E2DCD0" },
  { name: "Chalk", value: "#EDECE7" },
] as const;

export const STARTER_WALLS = [
  { color: "#CDD0CA", pattern: "stripe" },
  { color: "#E2DCD0", pattern: "grid" },
  { color: "#EDECE7", pattern: "pinstripe" },
  { color: "#45524B", pattern: "trellis" },
  { color: "#4C5B6B", pattern: "check" },
  { color: "#524650", pattern: "dots" },
] as const;

export function randomWallStyle() {
  return { ...STARTER_WALLS[Math.floor(Math.random() * STARTER_WALLS.length)] };
}
