import { StyleSheet, View } from "react-native";
import type { ReactNode } from "react";
import type { WallFrame as Frame } from "@/lib/wall/wall-layout";

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
    gradient:
      "linear-gradient(135deg, #D9B95E 0%, #8A6620 30%, #F0D68A 50%, #7A5A18 78%, #D9B95E 100%)",
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
  const finish = wallFrames.find((item) => item.value === frame)!;
  return Math.min(finish.width, (finish.width * width) / 166);
}

export function WallFrame({
  frame,
  children,
  width,
}: {
  frame: Frame;
  children: ReactNode;
  width: number;
}) {
  const finish = wallFrames.find((item) => item.value === frame)!;
  const inset = wallFrameInset(frame, width);
  return (
    <View
      style={{
        width,
        padding: inset,
        backgroundColor: finish.color,
        experimental_backgroundImage: finish.gradient,
        boxShadow:
          frame === "none" || frame === "black"
            ? undefined
            : width < 70
              ? "0 1px 3px rgba(0,0,0,0.25)"
              : "0 14px 22px -12px rgba(0,0,0,0.65), 0 2px 3px rgba(0,0,0,0.28)",
      }}
    >
      {children}
      {frame !== "none" && (
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              borderWidth: frame === "mat" ? 1 : 0.5,
              borderTopColor: frame === "mat" ? "#2E2A26" : "rgba(255,240,205,0.5)",
              borderLeftColor: frame === "mat" ? "#2E2A26" : "rgba(255,240,205,0.35)",
              borderBottomColor: "rgba(35,26,15,0.6)",
              borderRightColor: "rgba(35,26,15,0.45)",
            },
          ]}
        />
      )}
      {frame === "baroque" && (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            inset: inset * 0.45,
            borderWidth: Math.min(1, inset * 0.2),
            borderColor: "#6D501B",
          }}
        />
      )}
      {inset > 0 && (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            inset,
            borderWidth: frame === "white" ? 2 : 0.5,
            borderColor: frame === "white" ? "#4F4B46" : "rgba(30,20,10,0.45)",
            boxShadow: "inset 0 1px 2px rgba(0,0,0,0.18)",
          }}
        />
      )}
    </View>
  );
}
