import { ThemedText as Text } from "@/components/themed-text";
import { BottomSheet, Group, Host, RNHostView } from "@expo/ui/swift-ui";
import {
  frame,
  presentationBackground,
  presentationDetents,
  presentationDragIndicator,
} from "@expo/ui/swift-ui/modifiers";
import type { ReactNode } from "react";
import { View } from "react-native";
import { Gallery } from "@/constants/theme";
import { GalleryButton } from "./gallery-button";

export function WallSheet({
  title,
  children,
  onDismiss,
  onDismissed,
  presented = true,
  tall = false,
  dismissLabel = "Done",
}: {
  title: string;
  children: ReactNode;
  onDismiss: () => void;
  tall?: boolean;
  dismissLabel?: string;
  /** `presented={false}` animates the sheet out while it stays mounted; `onDismissed` fires once the presentation has fully ended. */
  presented?: boolean;
  onDismissed?: () => void;
}) {
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
            presentationDetents(tall ? ["large"] : [{ height: 300 }, "large"]),
            presentationBackground(Gallery.paper),
          ]}
        >
          {/* Presented content needs its own React Native touch and measurement root. */}
          <RNHostView>
            <View style={{ flex: 1 }}>
              <View style={styles.sheetHeader}>
                <Text variant="section" accessibilityRole="header" style={styles.sheetTitle}>
                  {title}
                </Text>
                <GalleryButton label={dismissLabel} fullWidth={false} onPress={onDismiss} />
              </View>
              {children}
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
    paddingTop: 8,
    paddingBottom: 4,
    flexDirection: "row" as const,
    justifyContent: "space-between" as const,
    alignItems: "center" as const,
    borderBottomWidth: 0.5,
    borderColor: Gallery.separator,
  },
  sheetTitle: { flex: 1, color: Gallery.ink },
};
