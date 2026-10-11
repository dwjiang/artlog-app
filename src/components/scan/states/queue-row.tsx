import { Host, Icon } from "@expo/ui";
import { Button, Menu } from "@expo/ui/swift-ui";
import { accessibilityLabel, buttonStyle, contentShape, disabled, frame, shapes } from "@expo/ui/swift-ui/modifiers";
import { Image } from "expo-image";
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

export const RETRY_ROW = "Retry scan";

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
  return (
    <View style={styles.row}>
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
          modifiers={[
            accessibilityLabel(`Options for scan from ${when}`),
            buttonStyle("plain"),
            disabled(discarding || retrying),
          ]}
        >
          <Button label="Resume" systemImage="arrow.right" onPress={() => onOpen(item)} />
          {item.status === "failed" && (
            <Button
              label={RETRY_ROW}
              systemImage="arrow.clockwise"
              modifiers={[disabled(retrying || discarding)]}
              onPress={() => onRetry(item)}
            />
          )}
          <Button label="Discard scan" systemImage="trash" role="destructive" onPress={() => onDiscard(item)} />
        </Menu>
      </Host>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Gallery.separator,
  },
  capture: {
    flex: 1,
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
