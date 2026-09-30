import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { wallFrameInset, wallFrames } from "@/lib/wall/wall-frames";
import type { WallFrame as Frame } from "@/lib/wall/wall-layout";

export function WallFrame({ frame, children, width }: { frame: Frame; children: ReactNode; width: number }) {
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
