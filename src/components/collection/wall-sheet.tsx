import { BottomSheet, Group, Host, RNHostView } from "@expo/ui/swift-ui";
import {
  frame,
  presentationBackground,
  presentationDetents,
  presentationDragIndicator,
} from "@expo/ui/swift-ui/modifiers";
import type { ReactNode } from "react";
import { ScrollView, View } from "react-native";

import { ThemedText as Text } from "@/components/themed-text";
import { ToastLayer } from "@/components/toast";
import { Gallery } from "@/constants/theme";
import { useFittedSheetHeight } from "@/hooks/use-fitted-sheet";

import { GalleryButton } from "./gallery-button";

export function WallSheet({
  title,
  children,
  footer,
  onDismiss,
  onDismissed,
  presented = true,
  size = "fit",
  dismissLabel = "Done",
}: {
  title: string;
  children: ReactNode;
  /** Stays pinned below the children, which scroll once the sheet outgrows the screen. */
  footer?: ReactNode;
  onDismiss: () => void;
  /** `fit` sizes the sheet to its header, children and footer; `large` leaves layout and scrolling to the children. */
  size?: "fit" | "large";
  dismissLabel?: string;
  /** `presented={false}` animates the sheet out while it stays mounted; `onDismissed` fires once the presentation has fully ended. */
  presented?: boolean;
  onDismissed?: () => void;
}) {
  const fitted = useFittedSheetHeight();
  const fit = size === "fit";
  return (
    <Host style={{ position: "absolute" }} pointerEvents="none">
      <BottomSheet
        isPresented={presented}
        onIsPresentedChange={(value) => {
          if (!value) onDismiss();
        }}
        onDismiss={onDismissed}
      >
        <Group
          modifiers={[
            frame({ maxWidth: Infinity, alignment: "topLeading" }),
            presentationDragIndicator("visible"),
            presentationDetents([!fit ? "large" : fitted.height ? { height: fitted.height } : "medium"]),
            presentationBackground(Gallery.paper),
          ]}
        >
          {/* Presented content needs its own React Native touch and measurement root. */}
          <RNHostView>
            <View style={{ height: fit ? fitted.height : fitted.maxHeight }}>
              <View style={styles.sheetHeader} onLayout={fitted.onHeaderLayout}>
                <Text variant="section" accessibilityRole="header" style={styles.sheetTitle}>
                  {title}
                </Text>
                <GalleryButton label={dismissLabel} fullWidth={false} onPress={onDismiss} />
              </View>
              {fit ? (
                <ScrollView alwaysBounceVertical={false} onContentSizeChange={fitted.onContentSizeChange}>
                  {children}
                </ScrollView>
              ) : (
                children
              )}
              {footer && <View onLayout={fitted.onFooterLayout}>{footer}</View>}
              <ToastLayer offset={0} />
            </View>
          </RNHostView>
        </Group>
      </BottomSheet>
    </Host>
  );
}

const styles = {
  sheetHeader: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 4,
    flexDirection: "row" as const,
    justifyContent: "space-between" as const,
    alignItems: "center" as const,
    borderBottomWidth: 0.5,
    borderColor: Gallery.separator,
  },
  sheetTitle: { flex: 1, color: Gallery.ink },
};
