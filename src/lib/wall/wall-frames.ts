import type { WallFrame as Frame } from "./wall-layout";

export const wallFrames: {
  value: Frame;
  name: string;
  color: string;
  width: number;
  gradient?: string;
}[] = [
  {
    value: "gilt",
    name: "Gilt",
    color: "#B3924B",
    width: 4,
    gradient: "linear-gradient(135deg, #E3C77A 0%, #9C7A36 35%, #E6CB80 55%, #8A6A2A 100%)",
  },
  {
    value: "baroque",
    name: "Baroque",
    color: "#8A6620",
    width: 8,
    gradient: "linear-gradient(135deg, #D9B95E 0%, #8A6620 30%, #F0D68A 50%, #7A5A18 78%, #D9B95E 100%)",
  },
  {
    value: "walnut",
    name: "Walnut",
    color: "#45301F",
    width: 5,
    gradient:
      "linear-gradient(135deg, #6B4E35 0%, #4A3324 15%, #3A281C 28%, #59402C 40%, #45301F 53%, #60462F 67%, #3A281C 82%, #4A3324 100%)",
  },
  {
    value: "oak",
    name: "Oak",
    color: "#C4A066",
    width: 5,
    gradient:
      "linear-gradient(135deg, #DCC08C 0%, #C4A066 18%, #D3B27A 32%, #B99156 46%, #DCC08C 61%, #C4A066 80%, #D3B27A 100%)",
  },
  { value: "black", name: "Black", color: "#1C1A18", width: 2.5 },
  { value: "white", name: "White float", color: "#F4F2EE", width: 6 },
  { value: "mat", name: "Mat", color: "#F5F3EE", width: 11 },
  { value: "none", name: "No frame", color: "transparent", width: 0 },
];

export function wallFrameInset(frame: Frame, width: number) {
  "worklet";
  const finish = wallFrames.find((item) => item.value === frame)!;
  return Math.min(finish.width, (finish.width * width) / 166);
}
