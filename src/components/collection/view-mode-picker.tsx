import { Button, Host, Row, Text } from '@expo/ui';
import { accessibilityAddTraits, background, frame, shadow, shapes } from '@expo/ui/swift-ui/modifiers';

import { Gallery } from '@/constants/theme';

export const viewModes = ['wall', 'grid', 'az', 'visits'] as const;
export type ViewMode = (typeof viewModes)[number];

const labels: Record<ViewMode, string> = { wall: 'Wall', grid: 'Grid', az: 'A–Z', visits: 'Visits' };

export function ViewModePicker({ mode, onChange, disabled = false }: { mode: ViewMode; onChange: (mode: ViewMode) => void; disabled?: boolean }) {
  const options: ViewMode[] = mode === 'wall' || mode === 'visits' ? ['wall', 'visits'] : ['grid', 'az'];
  return <Host matchContents={{ vertical: true }} colorScheme="light" style={{ width: '100%' }}>
    <Row spacing={0} style={{ padding: 2, backgroundColor: Gallery.segmentTrack, borderRadius: 10, opacity: disabled ? 0.55 : 1 }}
      modifiers={[frame({ maxWidth: Infinity })]}>
      {options.map((value) => <Button key={value} variant="text" disabled={disabled} onPress={() => onChange(value)}
        modifiers={[accessibilityAddTraits(value === mode ? ['isSelected'] : [])]}>
        <Row spacing={0} modifiers={[
          // Fixed height would make Expo UI ignore maxWidth.
          frame({ maxWidth: Infinity, minHeight: 33, maxHeight: 33 }),
          background(value === mode ? Gallery.segmentSelection : 'transparent', shapes.roundedRectangle({ cornerRadius: 7 })),
          ...(value === mode ? [shadow({ color: '#00000020', radius: 2, y: 1 })] : []),
        ]}>
          <Text textStyle={{ fontSize: 14, fontWeight: '600', color: Gallery.ink }}>{labels[value]}</Text>
        </Row>
      </Button>)}
    </Row>
  </Host>;
}
