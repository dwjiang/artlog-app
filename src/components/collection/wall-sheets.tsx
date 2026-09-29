import { StyleSheet, View } from "react-native";

import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, Spacing } from "@/constants/theme";
import { wallAspect, type WallLayout, type WallPiece, type Wallpaper } from "@/lib/wall/wall-layout";

import { WallArtwork } from "./wall-artwork";
import { WallFramePicker } from "./wall-options";
import { WallSheet } from "./wall-sheet";
import { wallpaperStyle } from "./wallpaper";

function WallArtworkSummary({ piece, wallpaper }: { piece: WallPiece; wallpaper: Wallpaper }) {
  return (
    <>
      <View style={[styles.hero, wallpaperStyle(wallpaper)]}>
        <WallArtwork piece={piece} width={Math.min(230, 180 * wallAspect(piece))} />
      </View>
      <View style={styles.section}>
        <Text variant="display" selectable style={styles.artist}>
          {piece.artwork.artist}
        </Text>
        <Text selectable style={styles.workTitle}>
          {piece.artwork.title}
          {piece.artwork.date ? <Text style={styles.date}>, {piece.artwork.date}</Text> : null}
        </Text>
        {piece.artwork.medium && (
          <Text selectable style={styles.caption}>
            {piece.artwork.medium}
          </Text>
        )}
      </View>
    </>
  );
}

export function WallArtworkSheet({
  piece,
  editing,
  disabled = false,
  wallpaper,
  onChange,
  onDismiss,
}: {
  piece: WallPiece;
  editing: boolean;
  wallpaper: Wallpaper;
  onChange: (layout: WallLayout) => void;
  onDismiss: () => void;
  disabled?: boolean;
}) {
  return (
    <WallSheet title={editing ? "Edit frame" : "On your wall"} onDismiss={onDismiss}>
      <View style={{ paddingBottom: Spacing.five }}>
        {editing ? (
          <>
            <View style={[styles.editPreview, wallpaperStyle(wallpaper)]}>
              <WallArtwork piece={piece} width={Math.min(120, 100 * wallAspect(piece))} />
              <View style={styles.editLabel}>
                <Text variant="secondary" numberOfLines={2} style={{ fontWeight: "600" }}>
                  {piece.artwork.title}
                </Text>
                <Text variant="metadata" themeColor="textSecondary" numberOfLines={1}>
                  {piece.artwork.artist}
                </Text>
              </View>
            </View>
            <View style={{ paddingVertical: Spacing.three }}>
              <WallFramePicker
                piece={piece}
                value={piece.layout.frame}
                disabled={disabled}
                onChange={(frame) => {
                  if (!disabled) onChange({ ...piece.layout, frame });
                }}
              />
            </View>
          </>
        ) : (
          <WallArtworkSummary piece={piece} wallpaper={wallpaper} />
        )}
      </View>
    </WallSheet>
  );
}

const styles = StyleSheet.create({
  section: { padding: 20, gap: 8 },
  caption: { fontSize: 13, lineHeight: 18, color: Gallery.muted },
  hero: { alignItems: "center", justifyContent: "center", paddingVertical: 26, paddingHorizontal: 24 },
  artist: { color: Gallery.ink },
  workTitle: { fontSize: 17, lineHeight: 25, color: Gallery.ink },
  date: { fontStyle: "normal", color: Gallery.muted },
  editPreview: { padding: Spacing.content, alignItems: "center", justifyContent: "center", gap: Spacing.three },
  editLabel: {
    backgroundColor: Gallery.paper,
    borderRadius: 6,
    paddingHorizontal: Spacing.compact,
    paddingVertical: Spacing.two,
    alignItems: "center",
  },
});
