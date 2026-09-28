import type { ReactNode } from "react";
import { View } from "react-native";

import { Gallery } from "@/constants/theme";

import { ThemedText as Text } from "./themed-text";

export function NotePaper({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <View
      style={{
        gap: 8,
      }}
    >
      {label && (
        <Text
          style={{
            fontSize: 12,
            lineHeight: 18,
            color: Gallery.muted,
          }}
        >
          {label}
        </Text>
      )}
      {children}
    </View>
  );
}
