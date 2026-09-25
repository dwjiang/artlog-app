import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { SavedWorkImage } from "@/components/collection/saved-work-image";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, Radius } from "@/constants/theme";

import { VisitSymbol } from "./visit-ui";

/** A square share choice: an ink border and a lime badge mark it chosen; a veil fades it when left out. */
export function ShareTileImage({
  size,
  selected,
  badge,
  children,
}: {
  size: number;
  selected: boolean;
  badge: ReactNode;
  children: ReactNode;
}) {
  return (
    <View style={[styles.stage, { width: size, height: size }]}>
      {children}
      <View pointerEvents="none" style={[styles.edge, selected ? styles.edgeOn : styles.veil]} />
      {selected && (
        <View pointerEvents="none" style={styles.badge}>
          {badge}
        </View>
      )}
    </View>
  );
}

/**
 * One square artwork in the share grid. Tapping it includes or leaves it out; an included one shows its place in the
 * shared order and a link that picks which of its photos are shared.
 */
export function ShareArtworkTile({
  title,
  artist,
  path,
  size,
  position,
  photos,
  disabled,
  selectable,
  onToggle,
  onChoosePhotos,
  onMove,
}: {
  title: string;
  artist: string | null;
  path: string | null;
  size: number;
  /** Zero-based place in the shared order, or undefined when the artwork is left out. */
  position?: number;
  photos: { chosen: number; total: number };
  disabled: boolean;
  selectable: boolean;
  onToggle: () => void;
  onChoosePhotos: () => void;
  onMove?: (offset: -1 | 1) => void;
}) {
  const included = position !== undefined;
  return (
    <View style={{ width: size }}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel={`Share ${title}`}
        accessibilityValue={included ? { text: `${position + 1}` } : undefined}
        accessibilityState={{ checked: included, disabled: disabled || !selectable }}
        accessibilityActions={
          onMove
            ? [
                { name: "moveEarlier", label: "Move earlier" },
                { name: "moveLater", label: "Move later" },
              ]
            : undefined
        }
        onAccessibilityAction={(event) => onMove?.(event.nativeEvent.actionName === "moveEarlier" ? -1 : 1)}
        disabled={disabled || !selectable}
        onPress={onToggle}
      >
        <ShareTileImage
          size={size}
          selected={included}
          badge={<Text style={styles.badgeText}>{included ? position + 1 : ""}</Text>}
        >
          <SavedWorkImage path={path} title={title} style={{ width: size, height: size }} />
        </ShareTileImage>
        <Text numberOfLines={2} style={[styles.title, !included && styles.dim]}>
          {title}
        </Text>
        <Text numberOfLines={1} style={[styles.artist, !included && styles.dim]}>
          {artist || "Artist unknown"}
        </Text>
      </Pressable>
      {included && photos.total > 0 && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Choose photos for ${title}, ${photos.chosen} of ${photos.total} selected`}
          accessibilityState={{ disabled }}
          disabled={disabled}
          hitSlop={{ top: 6, bottom: 12, left: 8, right: 8 }}
          onPress={onChoosePhotos}
          style={styles.photosLink}
        >
          <Text style={styles.photosText}>
            {photos.chosen} of {photos.total} {photos.total === 1 ? "photo" : "photos"}
          </Text>
          <VisitSymbol name="chevron.right" size={9} color={Gallery.accent} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  stage: {
    borderRadius: Radius.thumbnail,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  edge: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, borderRadius: Radius.thumbnail },
  edgeOn: { borderWidth: 2, borderColor: Gallery.ink },
  veil: {
    backgroundColor: "rgba(252, 252, 249, 0.62)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Gallery.controlBorder,
  },
  badge: {
    position: "absolute",
    top: 8,
    left: 8,
    minWidth: 24,
    height: 24,
    paddingHorizontal: 7,
    borderRadius: 12,
    backgroundColor: Gallery.highlight,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { fontSize: 12, lineHeight: 16, fontWeight: "600", color: Gallery.ink, fontVariant: ["tabular-nums"] },
  title: { fontSize: 15, lineHeight: 21, fontWeight: "600", color: Gallery.ink, marginTop: 8 },
  artist: { fontSize: 13, lineHeight: 18, color: Gallery.muted, marginTop: 2 },
  dim: { opacity: 0.5 },
  photosLink: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 3, minHeight: 20 },
  photosText: { fontSize: 13, lineHeight: 18, color: Gallery.accent },
});
