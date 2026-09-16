import { Button, Column, Host, RNHostView, Text as NativeText } from '@expo/ui';
import { accessibilityAddTraits, accessibilityLabel, frame } from '@expo/ui/swift-ui/modifiers';
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Gallery } from '@/constants/theme';
import type { WallFrame as Frame } from '@/lib/wall/wall-layout';
import { WallFrame, wallFrameInset, wallFrames } from './wall-frame';

function WallChoice({ label, selected, onPress, children, width = 68 }: {
  label: string; selected: boolean; onPress: () => void; children: ReactNode; width?: number;
}) {
  return <Host matchContents colorScheme="light" seedColor={Gallery.accent}>
    <Button variant="text" onPress={onPress}
      style={{ paddingVertical: 9, borderRadius: 10, backgroundColor: selected ? Gallery.fill : 'transparent' }}
      modifiers={[frame({ width, minHeight: 72 }), accessibilityLabel(label), accessibilityAddTraits(selected ? ['isSelected'] : [])]}>
      <Column spacing={7} alignment="center">
        <RNHostView matchContents>
          <View pointerEvents="none" style={styles.preview}>{children}</View>
        </RNHostView>
        <NativeText textStyle={{ fontSize: 10, fontWeight: selected ? '600' : '400', color: selected ? Gallery.ink : Gallery.muted }}>{label}</NativeText>
      </Column>
    </Button>
  </Host>;
}

export function WallFramePicker({ value, onChange }: { value: Frame; onChange: (value: Frame) => void }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.frames}>
    {wallFrames.map((finish) => <WallChoice key={finish.value} label={finish.name} width={56} selected={finish.value === value} onPress={() => onChange(finish.value)}>
      <WallFrame frame={finish.value} width={38}>
        <View style={{ width: 38 - wallFrameInset(finish.value, 38) * 2, height: 28 - wallFrameInset(finish.value, 38) * 2,
          backgroundColor: '#667B81', experimental_backgroundImage: 'linear-gradient(155deg, #D8C79A 0%, #81928F 30%, #3F4E58 100%)' }} />
      </WallFrame>
    </WallChoice>)}
  </ScrollView>;
}

const styles = StyleSheet.create({
  preview: { width: 44, height: 36, alignItems: 'center', justifyContent: 'center' },
  frames: { paddingHorizontal: 14, gap: 2, paddingBottom: 4 },
});
