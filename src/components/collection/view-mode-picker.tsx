import { NativeSegmentedPicker } from './native-segmented-picker';

export const viewModes = ['wall', 'grid', 'az', 'visits'] as const;
export type ViewMode = (typeof viewModes)[number];
const labels: Record<ViewMode, string> = { wall: 'Wall', grid: 'Grid', az: 'A–Z', visits: 'Visits' };

export function ViewModePicker({ mode, onChange, disabled = false }: { mode: ViewMode; onChange: (mode: ViewMode) => void; disabled?: boolean }) {
  const options: ViewMode[] = mode === 'wall' || mode === 'visits' ? ['wall', 'visits'] : ['grid', 'az'];
  return <NativeSegmentedPicker label="Collection view" value={mode} onChange={onChange} disabled={disabled}
    options={options.map((value) => ({ value, label: labels[value] }))} />;
}
