import { BottomSheet, Group, Host, RNHostView } from "@expo/ui/swift-ui";
import {
  frame,
  interactiveDismissDisabled,
  presentationBackground,
  presentationDetents,
  presentationDragIndicator,
} from "@expo/ui/swift-ui/modifiers";
import { useState, type ComponentProps, type ReactNode } from "react";
import { ScrollView, View } from "react-native";

import { EditBar } from "@/components/sheet-controls";
import { ToastLayer } from "@/components/toast";
import { Gallery } from "@/constants/theme";
import { confirmDiscardEdits } from "@/hooks/use-discard-edits-guard";
import { useFittedSheetHeight } from "@/hooks/use-fitted-sheet";

/**
 * A leaderboard setting edited in a sheet: Cancel and `commit` in its bar over the scrolling choices. While `edited`,
 * Cancel asks before discarding the change and the sheet can't be swiped away, since SwiftUI can't ask on a swipe.
 */
export function LeaderboardSheet({
  title,
  children,
  onDismiss,
  commit,
  cancelDisabled = false,
  edited = false,
}: {
  title: string;
  children: ReactNode;
  onDismiss: () => void;
  commit: ComponentProps<typeof EditBar>["commit"];
  cancelDisabled?: boolean;
  edited?: boolean;
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
            interactiveDismissDisabled(edited),
          ]}
        >
          <RNHostView>
            <View style={{ height: fitted.height }}>
              <View onLayout={fitted.onHeaderLayout} style={{ paddingHorizontal: 20, paddingTop: 16 }}>
                <EditBar
                  title={title}
                  cancelDisabled={cancelDisabled}
                  onCancel={() => (edited ? confirmDiscardEdits(() => setOpen(false)) : setOpen(false))}
                  commit={commit}
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
