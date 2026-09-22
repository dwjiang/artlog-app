import { ThemedText as Text } from '@/components/themed-text';
import { WallSheet } from './wall-sheet';
import { Host } from '@expo/ui';
import { Slider } from '@expo/ui/swift-ui';
import { accessibilityLabel, disabled as nativeDisabled } from '@expo/ui/swift-ui/modifiers';
import { useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Gallery, Spacing } from '@/constants/theme';
import { constrainLayout, wallAspect, type WallLayout, type WallPiece } from '@/lib/wall/wall-layout';
import { WallArtwork } from './wall-artwork';
import { GalleryButton } from './gallery-button';
import { WallFramePicker } from './wall-options';

export function WallArtworkSummary({ piece, color }: { piece: WallPiece; color: string }) {
  return <>
    <View style={[styles.hero, { backgroundColor: color }]}>
      <WallArtwork piece={piece} width={Math.min(230, 180 * wallAspect(piece))} />
    </View>
    <View style={styles.section}>
      <Text variant="display" selectable style={styles.artist}>{piece.artwork.artist}</Text>
      <Text selectable style={styles.workTitle}>{piece.artwork.title}{piece.artwork.date ? <Text style={styles.date}>, {piece.artwork.date}</Text> : null}</Text>
      {piece.artwork.medium && <Text selectable style={styles.caption}>{piece.artwork.medium}</Text>}
    </View>
  </>;
}

function WallSizeSlider({ width, disabled, onChange }: { width: number; disabled: boolean; onChange: (width: number) => void }) {
  const [value, setValue] = useState(width);
  const dragging = useRef(false), latest = useRef(width);
  function commit() { if (!disabled && latest.current !== width) onChange(latest.current); }
  return <Host matchContents={{ vertical: true }} colorScheme="light" seedColor={Gallery.accent} style={{ width: '100%' }}>
    <Slider value={value} min={0.16} max={0.9} step={0.01}
      onValueChange={(next) => {
        if (disabled) return;
        latest.current = next; setValue(next);
        // VoiceOver adjustments can change the value without starting a drag.
        if (!dragging.current) commit();
      }}
      onEditingChanged={(editing) => { dragging.current = editing; if (!editing) commit(); }}
      modifiers={[accessibilityLabel('Artwork size'), nativeDisabled(disabled)]} />
  </Host>;
}

export function WallArtworkSheet({ piece, editing, disabled = false, color, onChange, onRemove, onDismiss, onDismissed, presented, onChoosePhoto, onDuplicatePhoto }: {
  piece: WallPiece; editing: boolean; color: string; onChange: (layout: WallLayout) => void;
  onRemove: () => void; onDismiss: () => void; disabled?: boolean;
  presented?: boolean; onDismissed?: () => void; onChoosePhoto?: () => void; onDuplicatePhoto?: () => void;
}) {
  const change = (patch: Partial<WallLayout>) => { if (!disabled) onChange(constrainLayout(piece.layout, patch)); };
  return <WallSheet title={editing ? 'Edit artwork' : 'On your wall'} onDismiss={onDismiss} onDismissed={onDismissed} presented={presented} tall>
    <ScrollView contentContainerStyle={{ paddingBottom: Spacing.five }}>
      <WallArtworkSummary piece={piece} color={color} />
      {editing && <>
        {onChoosePhoto && <View style={styles.section}>
          <GalleryButton label="Choose photo" icon="photo" fullWidth contentAlignment="leading" disabled={disabled} onPress={onChoosePhoto} />
          <GalleryButton label="Hang another photo" icon="plus" fullWidth contentAlignment="leading" disabled={disabled || !onDuplicatePhoto} onPress={() => onDuplicatePhoto?.()} />
        </View>}
        <Text style={styles.sectionHeading}>Frame</Text>
        <WallFramePicker piece={piece} value={piece.layout.frame} disabled={disabled} onChange={(frame) => change({ frame })} />
        <View style={[styles.section, styles.controls]}>
          <Text style={styles.heading}>Size on the wall</Text>
          <WallSizeSlider key={`${piece.localId}:${piece.layout.width}`} width={piece.layout.width} disabled={disabled} onChange={(width) => change({ width })} />
          <Text style={styles.heading}>Position</Text>
          <View style={styles.directions}>
            <GalleryButton label="Left" icon="arrow.left" disabled={disabled} onPress={() => change({ x: piece.layout.x - 0.025 })} />
            <GalleryButton label="Right" icon="arrow.right" disabled={disabled} onPress={() => change({ x: piece.layout.x + 0.025 })} />
            <GalleryButton label="Up" icon="arrow.up" disabled={disabled} onPress={() => change({ y: piece.layout.y - 0.025 })} />
            <GalleryButton label="Down" icon="arrow.down" disabled={disabled} onPress={() => change({ y: piece.layout.y + 0.025 })} />
          </View>
          <Text style={styles.caption}>You can also hold and drag the artwork on your wall.</Text>
        </View>
        <View style={[styles.section, styles.removal]}>
          <GalleryButton label="Take off wall" icon="minus.circle" disabled={disabled} onPress={onRemove} variant="outlined" fullWidth destructive />
          <Text style={[styles.caption, { textAlign: 'center' }]}>The artwork stays in your collection.</Text>
        </View>
      </>}
    </ScrollView>
  </WallSheet>;
}

const styles = StyleSheet.create({
  section: { padding: 20, gap: 8 },
  caption: { fontSize: 13, lineHeight: 18, color: Gallery.muted },
  hero: { alignItems: 'center', justifyContent: 'center', paddingVertical: 26, paddingHorizontal: 24 },
  artist: { color: Gallery.ink },
  workTitle: { fontSize: 17, lineHeight: 25, color: Gallery.ink },
  date: { fontStyle: 'normal', color: Gallery.muted },
  heading: { fontSize: 13, fontWeight: '600', color: Gallery.ink },
  sectionHeading: { fontSize: 13, fontWeight: '600', color: Gallery.ink, paddingHorizontal: 20, paddingBottom: 8 },
  controls: { marginHorizontal: 20, paddingHorizontal: 0, borderTopWidth: StyleSheet.hairlineWidth, borderColor: Gallery.separator },
  directions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12 },
  removal: { paddingTop: 0 },
});
