import { BottomSheet, Host, RNHostView, Slider } from '@expo/ui';
import { accessibilityLabel } from '@expo/ui/swift-ui/modifiers';
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Gallery, Spacing } from '@/constants/theme';
import { constrainLayout, wallAspect, type WallLayout, type WallPiece } from '@/lib/wall/wall-layout';
import { WallArtwork } from './wall-gallery';
import { GalleryButton } from './gallery-button';
import { WallFramePicker } from './wall-options';

export function WallSheet({ title, children, onDismiss, tall = false }: {
  title: string; children: ReactNode; onDismiss: () => void; tall?: boolean;
}) {
  return <BottomSheet isPresented onDismiss={onDismiss} snapPoints={tall ? ['full'] : [{ height: 300 }, 'full']}
    contentPadding={0} containerColor={Gallery.paper}>
    {/* Presented content needs its own React Native touch and measurement root. */}
    <RNHostView>
      <View style={{ flex: 1 }}>
        <View style={styles.sheetHeader}>
          <Text accessibilityRole="header" style={styles.sheetTitle}>{title}</Text>
          <GalleryButton label="Done" onPress={onDismiss} />
        </View>
        {children}
      </View>
    </RNHostView>
  </BottomSheet>;
}

export function WallArtworkSummary({ piece, color }: { piece: WallPiece; color: string }) {
  return <>
    <View style={[styles.hero, { backgroundColor: color }]}>
      <WallArtwork piece={piece} width={Math.min(230, 180 * wallAspect(piece))} />
    </View>
    <View style={styles.section}>
      <Text selectable style={styles.artist}>{piece.artwork.artist}</Text>
      <Text selectable style={styles.workTitle}>{piece.artwork.title}{piece.artwork.date ? <Text style={styles.date}>, {piece.artwork.date}</Text> : null}</Text>
      {piece.artwork.medium && <Text selectable style={styles.caption}>{piece.artwork.medium}</Text>}
    </View>
  </>;
}

export function WallArtworkSheet({ piece, editing, color, onChange, onRemove, onDismiss }: {
  piece: WallPiece; editing: boolean; color: string; onChange: (layout: WallLayout) => void;
  onRemove: () => void; onDismiss: () => void;
}) {
  const change = (patch: Partial<WallLayout>) => onChange(constrainLayout(piece.layout, patch));
  return <WallSheet title={editing ? 'Edit artwork' : 'On your wall'} onDismiss={onDismiss} tall>
    <ScrollView contentContainerStyle={{ paddingBottom: Spacing.five }}>
      <WallArtworkSummary piece={piece} color={color} />
      {editing && <>
        <Text style={styles.sectionHeading}>Frame</Text>
        <WallFramePicker value={piece.layout.frame} onChange={(frame) => change({ frame })} />
        <View style={[styles.section, styles.controls]}>
          <Text style={styles.heading}>Size on the wall</Text>
          <Host matchContents={{ vertical: true }} colorScheme="light" seedColor={Gallery.accent}>
            <Slider value={piece.layout.width} onValueChange={(width) => change({ width })} min={0.16} max={0.9} step={0.01}
              modifiers={[accessibilityLabel('Artwork size')]} />
          </Host>
          <Text style={styles.heading}>Position</Text>
          <View style={styles.directions}>
            <GalleryButton label="Left" icon="arrow.left" onPress={() => change({ x: piece.layout.x - 0.025 })} />
            <GalleryButton label="Right" icon="arrow.right" onPress={() => change({ x: piece.layout.x + 0.025 })} />
            <GalleryButton label="Up" icon="arrow.up" onPress={() => change({ y: piece.layout.y - 0.025 })} />
            <GalleryButton label="Down" icon="arrow.down" onPress={() => change({ y: piece.layout.y + 0.025 })} />
          </View>
          <Text style={styles.caption}>You can also hold and drag the artwork on your wall.</Text>
        </View>
        <View style={[styles.section, styles.removal]}>
          <GalleryButton label="Take off wall" icon="minus.circle" onPress={onRemove} variant="outlined" fullWidth destructive />
          <Text style={[styles.caption, { textAlign: 'center' }]}>The artwork stays in your collection.</Text>
        </View>
      </>}
    </ScrollView>
  </WallSheet>;
}

export const wallSheetStyles = StyleSheet.create({
  section: { padding: 20, gap: 8 },
  caption: { fontSize: 12, lineHeight: 18, color: Gallery.muted },
  body: { fontSize: 14, lineHeight: 21, color: Gallery.ink },
});

const styles = StyleSheet.create({
  ...wallSheetStyles,
  sheetHeader: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderColor: Gallery.separator },
  sheetTitle: { fontSize: 15, fontWeight: '600', color: Gallery.ink },
  hero: { alignItems: 'center', justifyContent: 'center', paddingVertical: 26, paddingHorizontal: 24,
    experimental_backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.08) 0%, rgba(0,0,0,0.06) 100%)' },
  artist: { fontSize: 19, lineHeight: 25, fontWeight: '600', color: Gallery.ink },
  workTitle: { fontSize: 15, lineHeight: 22, fontStyle: 'italic', color: Gallery.ink },
  date: { fontStyle: 'normal', color: Gallery.muted },
  heading: { fontSize: 12, fontWeight: '600', color: Gallery.ink },
  sectionHeading: { fontSize: 12, fontWeight: '600', color: Gallery.ink, paddingHorizontal: 20, paddingBottom: 8 },
  controls: { marginHorizontal: 20, paddingHorizontal: 0, borderTopWidth: StyleSheet.hairlineWidth, borderColor: Gallery.separator },
  directions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12 },
  removal: { paddingTop: 0 },
});
