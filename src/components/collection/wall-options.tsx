import { Button, Column, Host, RNHostView, Text as NativeText } from '@expo/ui';
import { accessibilityAddTraits, accessibilityLabel, background, frame, shapes, strokeBorder } from '@expo/ui/swift-ui/modifiers';
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';

import { Gallery } from '@/constants/theme';
import type { WallFrame as Frame } from '@/lib/wall/wall-layout';
import { WallFrame, wallFrameInset, wallFrames } from './wall-frame';

const CHOICE_RADIUS = 6;

function WallChoice({ label, selected, onPress, children, width = 68, disabled = false }: {
  label: string; selected: boolean; onPress: () => void; children: ReactNode; width?: number; disabled?: boolean;
}) {
  const { fontScale } = useWindowDimensions();
  return <Host matchContents colorScheme="light" seedColor={Gallery.accent}>
    <Button variant="text" onPress={onPress} disabled={disabled}
      style={{ paddingVertical: 9 }}
      // Style borders are a square stroke clipped by the radius, which notches the corners; paint and stroke the padded
      // content instead, then reserve the chip's slot: modifiers apply inside-out, so the frame must come last.
      modifiers={[
        background(selected ? Gallery.segmentSelection : 'transparent', shapes.roundedRectangle({ cornerRadius: CHOICE_RADIUS })),
        strokeBorder({ color: selected ? Gallery.ink : 'transparent', shape: 'roundedRectangle', cornerRadius: CHOICE_RADIUS, style: { lineWidth: 1 } }),
        frame({ width: width * fontScale, minHeight: 72 }),
        accessibilityLabel(label), accessibilityAddTraits(selected ? ['isSelected'] : [])]}>
      <Column spacing={7} alignment="center">
        <RNHostView matchContents>
          <View pointerEvents="none" style={styles.preview}>{children}</View>
        </RNHostView>
        <NativeText textStyle={{ fontSize: 13 * fontScale, fontWeight: selected ? '600' : '400', color: selected ? Gallery.ink : Gallery.muted }}>{label}</NativeText>
      </Column>
    </Button>
  </Host>;
}

export function WallFramePicker({ value, onChange, disabled = false }: { value: Frame; onChange: (value: Frame) => void; disabled?: boolean }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.frames}>
    {wallFrames.map((finish) => <WallChoice key={finish.value} label={finish.name} width={80} selected={finish.value === value} disabled={disabled} onPress={() => onChange(finish.value)}>
      <WallFrame frame={finish.value} width={38}>
        <View style={{ width: 38 - wallFrameInset(finish.value, 38) * 2, height: 28 - wallFrameInset(finish.value, 38) * 2,
          backgroundColor: Gallery.fill }} />
      </WallFrame>
    </WallChoice>)}
  </ScrollView>;
}

const styles = StyleSheet.create({
  preview: { width: 44, height: 36, alignItems: 'center', justifyContent: 'center' },
  frames: { paddingHorizontal: 14, gap: 2, paddingBottom: 4 },
});
