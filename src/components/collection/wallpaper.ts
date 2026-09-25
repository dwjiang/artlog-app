import type { ViewStyle } from "react-native";

import { isLightWall, type WallPattern, type Wallpaper } from "@/lib/wall/wall-layout";

export const wallPatterns: { value: WallPattern | undefined; name: string }[] = [
  { value: undefined, name: "Plain" },
  { value: "stripe", name: "Stripe" },
  { value: "pinstripe", name: "Pinstripe" },
  { value: "check", name: "Check" },
  { value: "grid", name: "Grid" },
  { value: "dots", name: "Dots" },
  { value: "trellis", name: "Trellis" },
];

/** Patterns are a faint tint of the wall's label ink, so every color and pattern pair keeps its labels legible. */
export function wallpaperStyle({ color, pattern }: Wallpaper): ViewStyle {
  if (!pattern) return { backgroundColor: color };
  const rgb = isLightWall(color) ? "17, 17, 17" : "252, 252, 249";
  const ink = (alpha: number) => `rgba(${rgb}, ${alpha})`;
  const line = (direction: string, alpha: number) => `linear-gradient(${direction}, ${ink(alpha)} 1px, ${ink(0)} 1px)`;
  const band = (direction: string, alpha: number) => `linear-gradient(${direction}, ${ink(alpha)} 50%, ${ink(0)} 50%)`;
  const diagonal = (direction: string) =>
    `linear-gradient(${direction}, ${ink(0)} 48.5%, ${ink(0.13)} 48.5%, ${ink(0.13)} 51.5%, ${ink(0)} 51.5%)`;
  const dot = `radial-gradient(circle, ${ink(0.15)} 2px, ${ink(0)} 2.5px)`;
  // Tiles stay at least 12 points wide: iOS replicates one layer per tile, so tiny tiles multiply layers on a tall wall.
  const tiles: Record<WallPattern, { image: string; size: string; position?: string }> = {
    stripe: { image: band("to right", 0.05), size: "36px 36px" },
    pinstripe: { image: line("to right", 0.14), size: "12px 12px" },
    check: { image: `${band("to right", 0.05)}, ${band("to bottom", 0.05)}`, size: "24px 24px" },
    grid: { image: `${line("to right", 0.1)}, ${line("to bottom", 0.1)}`, size: "28px 28px" },
    dots: { image: `${dot}, ${dot}`, size: "20px 20px", position: "0px 0px, 10px 10px" },
    trellis: { image: `${diagonal("45deg")}, ${diagonal("135deg")}`, size: "32px 32px" },
  };
  const tile = tiles[pattern];
  return {
    backgroundColor: color,
    experimental_backgroundImage: tile.image,
    experimental_backgroundSize: tile.size,
    experimental_backgroundRepeat: "repeat",
    ...(tile.position ? { experimental_backgroundPosition: tile.position } : {}),
  };
}
