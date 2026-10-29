import { Stack } from "expo-router";
import type { ReactNode } from "react";

import { Gallery } from "@/constants/theme";

type ScanOptionsToolbarProps = {
  /** Actions listed above Adjust Crop. The native menu drops anything that isn't a `Stack.Toolbar.MenuAction`. */
  children?: ReactNode;
  onAdjustCrop?: () => void;
  /** A `Stack.Toolbar.Button` beside the menu. */
  trailing?: ReactNode;
};

export function ScanOptionsToolbar({ children, onAdjustCrop, trailing }: ScanOptionsToolbarProps) {
  return (
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel="Scan options" tintColor={Gallery.ink}>
        {children}
        {onAdjustCrop && (
          <Stack.Toolbar.MenuAction icon="crop" onPress={onAdjustCrop}>
            Adjust Crop
          </Stack.Toolbar.MenuAction>
        )}
      </Stack.Toolbar.Menu>
      {trailing}
    </Stack.Toolbar>
  );
}
