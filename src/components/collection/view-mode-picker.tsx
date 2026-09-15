import { Host, Picker, Text } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { StyleSheet } from 'react-native';

import { Spacing } from '@/constants/theme';

export const viewModes = ['grid', 'canvas', 'az', 'visits'] as const;
export type ViewMode = (typeof viewModes)[number];

const labels: Record<ViewMode, string> = { grid: 'Grid', canvas: 'Canvas', az: 'A–Z', visits: 'Visits' };

export function ViewModePicker({ mode, onChange }: { mode: ViewMode; onChange: (mode: ViewMode) => void }) {
  return (
    <Host matchContents colorScheme="light" style={styles.host}>
      <Picker selection={mode} onSelectionChange={onChange} modifiers={[pickerStyle('segmented')]}>
        {viewModes.map((value) => (
          <Text key={value} modifiers={[tag(value)]}>{labels[value]}</Text>
        ))}
      </Picker>
    </Host>
  );
}

const styles = StyleSheet.create({
  host: { marginHorizontal: Spacing.three, marginBottom: Spacing.three },
});
