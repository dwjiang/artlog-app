import type { WallFrame } from "@/shared/wall/frames";

import type { FrameSource } from "./frame-patches";

// Cuts sit just inside each texture's opening to keep alpha fringes out of the tiled rails.
export const wallFrameAssets: Record<WallFrame, { source: number; bounds: FrameSource; sculpted?: boolean }> = {
  oak: {
    source: require("../../../assets/images/frames/natural-oak.webp"),
    bounds: { width: 512, height: 512, left: 82, right: 81, top: 82, bottom: 82 },
  },
  walnut: {
    source: require("../../../assets/images/frames/sculpted-walnut.webp"),
    bounds: { width: 512, height: 512, left: 76, right: 77, top: 74, bottom: 86 },
  },
  "ebonized-oak": {
    source: require("../../../assets/images/frames/ebonized-oak.webp"),
    bounds: { width: 512, height: 512, left: 79, right: 79, top: 79, bottom: 80 },
  },
  gilt: {
    source: require("../../../assets/images/frames/antique-gold.webp"),
    bounds: { width: 512, height: 512, left: 73, right: 72, top: 73, bottom: 83 },
  },
  "carved-leaf": {
    source: require("../../../assets/images/frames/carved-leaf.webp"),
    sculpted: true,
    bounds: {
      width: 768,
      height: 768,
      left: 130,
      right: 130,
      top: 144,
      bottom: 152,
      ornaments: { horizontal: { corner: 250, center: 184 }, vertical: { corner: 262, center: 176 } },
    },
  },
  "aged-silver": {
    source: require("../../../assets/images/frames/aged-silver.webp"),
    bounds: { width: 512, height: 512, left: 79, right: 79, top: 79, bottom: 80 },
  },
  "satin-silver-linen": {
    source: require("../../../assets/images/frames/satin-silver-linen.webp"),
    bounds: { width: 512, height: 512, left: 71, right: 70, top: 70, bottom: 71, railMode: "stretch" },
  },
  black: {
    source: require("../../../assets/images/frames/matte-black.webp"),
    bounds: { width: 512, height: 512, left: 71, right: 70, top: 71, bottom: 72 },
  },
  white: {
    source: require("../../../assets/images/frames/white-float.webp"),
    bounds: { width: 512, height: 512, left: 71, right: 72, top: 70, bottom: 73 },
  },
  mat: {
    source: require("../../../assets/images/frames/museum-mat.webp"),
    bounds: { width: 512, height: 512, left: 87, right: 87, top: 87, bottom: 87 },
  },
  "fine-scroll": {
    source: require("../../../assets/images/frames/fine-scroll.webp"),
    bounds: { width: 512, height: 512, left: 75, right: 75, top: 73, bottom: 89 },
  },
};
