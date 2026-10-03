import { Link } from "expo-router";
import type { ReactNode } from "react";
import { StyleSheet, type StyleProp, type ViewStyle } from "react-native";

import { MotionPressable } from "@/components/motion-pressable";
import type { SavedWork } from "@/db/schema";

type WorkLinkProps = {
  visitId?: string;
  work: Pick<SavedWork, "localId" | "title" | "artist">;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
};

export function WorkLink({ work, style, children, visitId }: WorkLinkProps) {
  return (
    <Link
      href={{
        pathname: "/saved/[savedId]",
        params: { savedId: work.localId, visitId },
      }}
      asChild
    >
      <MotionPressable
        accessibilityRole="button"
        accessibilityLabel={`${work.title}, ${work.artist}`}
        style={StyleSheet.flatten(style)}
      >
        {children}
      </MotionPressable>
    </Link>
  );
}
