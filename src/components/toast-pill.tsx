import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gallery } from '@/constants/theme';

/** The dark confirmation pill: one line of paper text with optional actions such as Undo. */
export function ToastPill({ message, actions, busy = false }: { message: string; actions?: { label: string; onPress: () => void }[]; busy?: boolean }) {
  return <View style={styles.pill} accessibilityLiveRegion="polite">
    <Text accessibilityRole="alert" style={styles.message}>{message}</Text>
    {actions?.map((action) => <Pressable key={action.label} accessibilityRole="button" disabled={busy} onPress={action.onPress} hitSlop={8} style={styles.action}>
      <Text style={styles.actionLabel}>{action.label}</Text>
    </Pressable>)}
  </View>;
}

const styles = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', gap: 12, minWidth: 180, maxWidth: '100%', paddingVertical: 12, paddingHorizontal: 15,
    borderRadius: 13, borderCurve: 'continuous', backgroundColor: 'rgba(38, 35, 32, 0.94)', boxShadow: '0 10px 24px -10px rgba(0,0,0,0.5)' },
  message: { flexShrink: 1, fontSize: 13, lineHeight: 18, color: Gallery.paper },
  action: { minHeight: 28, justifyContent: 'center' },
  actionLabel: { fontSize: 13, lineHeight: 18, fontWeight: '600', color: Gallery.paper },
});
