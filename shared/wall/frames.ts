export const WALL_FRAMES = [
  { value: "oak", name: "Natural Oak", color: "#B68B52", width: 9 },
  { value: "walnut", name: "Sculpted Walnut", color: "#49301F", width: 13 },
  { value: "ebonized-oak", name: "Ebonized Oak", color: "#24201B", width: 8 },
  { value: "gilt", name: "Antique Gold", color: "#B58A38", width: 14 },
  { value: "carved-leaf", name: "Carved Leaf", color: "#BB8B3D", width: 24 },
  { value: "aged-silver", name: "Aged Silver", color: "#9C9483", width: 12 },
  { value: "satin-silver-linen", name: "Satin Silver & Linen", color: "#C8C2B5", width: 16 },
  { value: "black", name: "Matte Black", color: "#242323", width: 7 },
  { value: "white", name: "White Float", color: "#F0EDE5", width: 10 },
  { value: "mat", name: "Museum Mat", color: "#EEEAE0", width: 22 },
  { value: "fine-scroll", name: "Fine Scroll", color: "#B58835", width: 18 },
] as const;

export type WallFrame = (typeof WALL_FRAMES)[number]["value"];

export function wallFrameInset(frame: WallFrame, width: number) {
  "worklet";
  const finish = WALL_FRAMES.find((item) => item.value === frame)!;
  return Math.min(finish.width, (finish.width * width) / 166);
}
