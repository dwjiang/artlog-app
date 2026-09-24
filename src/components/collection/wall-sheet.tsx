import { ThemedText as Text } from "@/components/themed-text";
import { BottomSheet, Group, Host, RNHostView } from "@expo/ui/swift-ui";
import {
  frame,
  presentationBackground,
  presentationDetents,
  presentationDragIndicator,
  type PresentationDetent,
} from "@expo/ui/swift-ui/modifiers";
import { useState, type ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { Gallery } from "@/constants/theme";
import { GalleryButton } from "./gallery-button";

export function WallSheet({
  title,
  children,
  onDismiss,
  onDismissed,
  presented = true,
  size,
  dismissLabel = "Done",
}: {
  title: string;
  children: ReactNode;
  onDismiss: () => void;
  /** `fit` sizes the sheet to its header and children, and scrolls the children once they outgrow the screen. */
  size?: "fit" | "large";
  dismissLabel?: string;
  /** `presented={false}` animates the sheet out while it stays mounted; `onDismissed` fires once the presentation has fully ended. */
  presented?: boolean;
  onDismissed?: () => void;
}) {
  const [fitted, setFitted] = useState({ header: 0, content: 0 });
  const fit = size === "fit";
  const detents: PresentationDetent[] = fit
    ? [fitted.content ? { height: fitted.header + fitted.content } : "medium"]
    : size === "large"
      ? ["large"]
      : [{ height: 300 }, "large"];
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
            presentationDetents(detents),
            presentationBackground(Gallery.paper),
          ]}
        >
          {/* Presented content needs its own React Native touch and measurement root. */}
          <RNHostView>
            <View style={{ flex: 1 }}>
              <View
                style={styles.sheetHeader}
                onLayout={
                  fit
                    ? ({ nativeEvent: { layout } }) => setFitted((value) => ({ ...value, header: layout.height }))
                    : undefined
                }
              >
                <Text variant="section" accessibilityRole="header" style={styles.sheetTitle}>
                  {title}
                </Text>
                <GalleryButton label={dismissLabel} fullWidth={false} onPress={onDismiss} />
              </View>
              {fit ? (
                <ScrollView
                  alwaysBounceVertical={false}
                  onContentSizeChange={(_, height) => setFitted((value) => ({ ...value, content: height }))}
                >
                  {children}
                </ScrollView>
              ) : (
                children
              )}
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
