import { BottomSheet, Group, Host, RNHostView } from "@expo/ui/swift-ui";
import {
  frame,
  presentationBackground,
  presentationDetents,
  presentationDragIndicator,
} from "@expo/ui/swift-ui/modifiers";
import { useState, type ReactNode } from "react";
import { ScrollView, View } from "react-native";

import { GalleryButton } from "@/components/collection/gallery-button";
import { ThemedText as Text } from "@/components/themed-text";
import { ToastLayer } from "@/components/toast";
import { Gallery } from "@/constants/theme";
import { useFittedSheetHeight } from "@/hooks/use-fitted-sheet";

export function LeaderboardSheet({
  title,
  children,
  onDismiss,
  dismissLabel = "Done",
  dismissDisabled = false,
}: {
  title: string;
  children: ReactNode;
  onDismiss: () => void;
  dismissLabel?: string;
  dismissDisabled?: boolean;
}) {
  const [open, setOpen] = useState(true);
  const fitted = useFittedSheetHeight();
  return (
    <Host style={{ position: "absolute" }} pointerEvents="none">
      <BottomSheet isPresented={open} onIsPresentedChange={setOpen} onDismiss={onDismiss}>
        <Group
          modifiers={[
            frame({ maxWidth: Infinity, alignment: "topLeading" }),
            presentationDetents([fitted.height ? { height: fitted.height } : "medium"]),
            presentationDragIndicator("visible"),
            presentationBackground(Gallery.paper),
          ]}
        >
          <RNHostView>
            <View style={{ height: fitted.height }}>
              <View
                onLayout={fitted.onHeaderLayout}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  paddingHorizontal: 20,
                  paddingTop: 16,
                }}
              >
                <Text accessibilityRole="header" style={{ fontSize: 22, fontWeight: "600", color: Gallery.ink }}>
                  {title}
                </Text>
                <GalleryButton
                  label={dismissLabel}
                  fullWidth={false}
                  disabled={dismissDisabled}
                  onPress={() => setOpen(false)}
                />
              </View>
              <ScrollView
                alwaysBounceVertical={false}
                onContentSizeChange={fitted.onContentSizeChange}
                contentContainerStyle={{ padding: 20, gap: 22 }}
              >
                {children}
              </ScrollView>
              <ToastLayer offset={0} />
            </View>
          </RNHostView>
        </Group>
      </BottomSheet>
    </Host>
  );
}
