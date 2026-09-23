import type { ReactNode } from "react";
import { View } from "react-native";
import { ThemedText as Text } from "./themed-text";
import { Gallery } from "@/constants/theme";

export function NotePaper({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <View
      style={{
        padding: 16,
        gap: 8,
        backgroundColor: "#F3F1E7",
        borderLeftWidth: 3,
        borderLeftColor: "#C9C4B4",
      }}
    >
      {label && (
        <Text style={{ fontSize: 10, lineHeight: 16, letterSpacing: 1.2, color: Gallery.muted }}>
          {label.toUpperCase()}
        </Text>
      )}
      {children}
    </View>
  );
}
