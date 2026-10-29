import { Host, Icon } from "@expo/ui";
import { Button, Menu } from "@expo/ui/swift-ui";
import { accessibilityLabel, buttonStyle, contentShape, disabled, frame, shapes } from "@expo/ui/swift-ui/modifiers";
import { Image } from "expo-image";
import { Link, type LinkMenuActionProps } from "expo-router";
import { StyleSheet, View } from "react-native";

import { LoadingRing } from "@/components/loading-ring";
import { MotionPressable } from "@/components/motion-pressable";
import { ThemedText } from "@/components/themed-text";
import { Colors, Gallery, Radius, Spacing } from "@/constants/theme";
import type { PendingScan, PendingScanStatus } from "@/db/schema";
import { readPhotoSession } from "@/lib/capture/photo-draft";
import { captureFileUri, scanDisplayPath } from "@/lib/files/photos";
import { formatRelativeTime } from "@/lib/queue/relative-time";
import { useRecentScanMetadata } from "@/lib/queue/use-recent-scan-metadata";

export const RETRY_ROW = "Retry Scan";

/** Where a row leads: the scan's local result. */
export const queueResultHref = (item: Pick<PendingScan, "localId">) =>
  ({ pathname: "/result/[scanId]", params: { scanId: `local-${item.localId}` } }) as const;

type RowAction = {
  label: string;
  icon: NonNullable<LinkMenuActionProps["icon"]>;
  destructive?: boolean;
  run: () => void;
};

export function queueStatusText(status: PendingScanStatus): string {
  switch (status) {
    case "queued":
      return "Waiting for signal";
    case "identifying":
      return "Identifying…";
    case "failed":
      return "Couldn’t identify";
    case "identified":
      return "Ready to save";
  }
}

export type QueueRowProps = {
  item: PendingScan;
  now?: number;
  onOpen: (item: PendingScan) => void;
  onRetry: (item: PendingScan) => void;
  retrying?: boolean;
  onDiscard: (item: PendingScan) => void;
  discarding?: boolean;
};

export function QueueRow({
  item,
  now,
  onOpen,
  onRetry,
  onDiscard,
  retrying = false,
  discarding = false,
}: QueueRowProps) {
  const when = formatRelativeTime(item.capturedAt, now);
  const status = queueStatusText(item.status);
  const hasLabel = Boolean(item.labelPhotoPath || item.qrUrl);
  const session = readPhotoSession(item.owner, item.photoPath);
  const { title, attribution, uncertain } = useRecentScanMetadata(item, session);
  const photoCount = session.photos.length + 1;
  const busy = discarding || retrying;
  const actions: RowAction[] = [
    { label: "Resume", icon: "arrow.right", run: () => onOpen(item) },
    ...(item.status === "failed"
      ? [{ label: RETRY_ROW, icon: "arrow.clockwise", run: () => onRetry(item) } satisfies RowAction]
      : []),
    { label: "Discard Scan", icon: "trash", destructive: true, run: () => onDiscard(item) },
  ];
  const menuAction = (action: RowAction) => (
    <Link.MenuAction
      key={action.label}
      icon={action.icon}
      destructive={action.destructive}
      disabled={busy}
      onPress={action.run}
    >
      {action.label}
    </Link.MenuAction>
  );
  return (
    <View style={styles.row}>
      {/* Link lends the row only its long-press menu. Its trigger is a plain view, so a press reaches the row, which
          closes this sheet before opening the scan. */}
      <Link href={queueResultHref(item)} asChild>
        <Link.Trigger>
          <View collapsable={false} style={styles.trigger}>
            <MotionPressable
              accessibilityRole="button"
              accessibilityLabel={[title, attribution, `Scan from ${when}`, status, uncertain && "Possible match"]
                .filter(Boolean)
                .join(", ")}
              onPress={() => onOpen(item)}
              disabled={discarding}
              accessibilityState={{ disabled: discarding, busy: discarding }}
              style={styles.capture}
            >
              <Image
                cachePolicy="memory"
                source={captureFileUri(scanDisplayPath(item.cropPath))}
                contentFit="cover"
                style={styles.thumbnail}
              />
              <View style={styles.text}>
                <ThemedText variant="section">{title}</ThemedText>
                {!!attribution && (
                  <ThemedText variant="secondary" themeColor="textSecondary">
                    {attribution}
                  </ThemedText>
                )}
                <ThemedText variant="metadata" themeColor="textSecondary">
                  {when} · {photoCount} {photoCount === 1 ? "photo" : "photos"}
                </ThemedText>
                {uncertain && (
                  <ThemedText variant="metadata" themeColor="warning">
                    Possible match
                  </ThemedText>
                )}
                {retrying || item.status === "identifying" || discarding ? (
                  <LoadingRing
                    accessibilityLabel={discarding ? "Discarding scan…" : retrying ? "Retrying…" : status}
                    style={{ alignSelf: "flex-start" }}
                  />
                ) : item.status !== "identified" ? (
                  <ThemedText
                    type="small"
                    style={{
                      alignSelf: "flex-start",
                      paddingHorizontal: 6,
                      paddingVertical: 3,
                      backgroundColor: Gallery.fill,
                    }}
                    themeColor={item.status === "failed" ? "error" : "warning"}
                  >
                    {status}
                  </ThemedText>
                ) : null}
              </View>
              {hasLabel && (
                <Image
                  source="sf:tag"
                  accessibilityLabel="Label attached"
                  style={styles.labelIcon}
                  tintColor={Colors.light.textSecondary}
                />
              )}
            </MotionPressable>
          </View>
        </Link.Trigger>
        <Link.Menu>
          {actions.filter((action) => !action.destructive).map(menuAction)}
          <Link.Menu inline>{actions.filter((action) => action.destructive).map(menuAction)}</Link.Menu>
        </Link.Menu>
      </Link>
      <Host matchContents colorScheme="light">
        <Menu
          label={
            <Icon
              name="ellipsis"
              size={20}
              color={Gallery.muted}
              modifiers={[frame({ width: 44, height: 44 }), contentShape(shapes.rectangle())]}
            />
          }
          modifiers={[accessibilityLabel(`Options for scan from ${when}`), buttonStyle("plain"), disabled(busy)]}
        >
          {actions.map((action) => (
            <Button
              key={action.label}
              label={action.label}
              systemImage={action.icon}
              role={action.destructive ? "destructive" : undefined}
              modifiers={[disabled(busy)]}
              onPress={action.run}
            />
          ))}
        </Menu>
      </Host>
    </View>
  );
}

const styles = StyleSheet.create({
  // No gap: the link lays its menu out as an empty sibling of the trigger, which a gap would space out too.
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Gallery.separator,
  },
  // The long-press preview lifts this view, so it carries the sheet's background.
  trigger: { flex: 1, marginRight: Spacing.two, backgroundColor: Colors.light.background },
  capture: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
  },
  thumbnail: {
    width: 88,
    height: 88,
    borderRadius: Radius.thumbnail,
    backgroundColor: Colors.light.backgroundElement,
  },
  text: { flex: 1, gap: Spacing.one },
  labelIcon: { width: 20, height: 20 },
});
