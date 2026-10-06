import type { ReactNode } from "react";
import { View } from "react-native";

import { ListSection } from "@/components/list-row";
import { Spacing } from "@/constants/theme";

/** The outlined list of completions; docked above the keyboard, it keeps the page gutters. */
export function SuggestionSection({ docked, children }: { docked: boolean; children: ReactNode }) {
  const list = <ListSection outlined>{children}</ListSection>;
  return docked ? (
    <View style={{ paddingHorizontal: Spacing.content, paddingVertical: Spacing.two }}>{list}</View>
  ) : (
    list
  );
}
