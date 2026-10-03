import { Image } from "expo-image";

import { Gallery } from "@/constants/theme";

const reactionPaths = {
  heart: "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z",
  comment: "M21 11.5a9 9 0 0 1-9 9 10 10 0 0 1-4.1-.9L3 21l1.4-4.7A9 9 0 1 1 21 11.5Z",
};
export function ReactionIcon({
  kind,
  filled = false,
  size = 22,
  color = Gallery.ink,
}: {
  kind: keyof typeof reactionPaths;
  filled?: boolean;
  size?: number;
  color?: string;
}) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="${reactionPaths[kind]}" fill="${filled ? "black" : "none"}" stroke="black" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  return (
    <Image
      source={{ uri: `data:image/svg+xml,${encodeURIComponent(svg)}` }}
      tintColor={filled ? Gallery.accent : color}
      accessible={false}
      style={{ width: size, height: size }}
    />
  );
}
