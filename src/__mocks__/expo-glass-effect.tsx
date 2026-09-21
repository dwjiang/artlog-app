// Liquid glass needs the native runtime; Jest renders the same tree on a plain view and reports glass unavailable.
import { View, type ViewProps } from 'react-native';

type GlassProps = ViewProps & { glassEffectStyle?: unknown; isInteractive?: boolean; colorScheme?: unknown; tintColor?: string };

export function GlassView({ glassEffectStyle: _style, isInteractive: _interactive, colorScheme: _scheme, tintColor: _tint, ...props }: GlassProps) {
  return <View {...props} />;
}

export function isLiquidGlassAvailable(): boolean {
  return false;
}
