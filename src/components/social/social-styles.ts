import { StyleSheet } from 'react-native';
import { Gallery, Spacing } from '@/constants/theme';

export const socialStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Gallery.paper },
  content: { paddingBottom: Spacing.four, flexGrow: 1 },
  section: { padding: Spacing.four, gap: Spacing.three },
  gate: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', paddingBottom: Spacing.four },
  state: { paddingHorizontal: Spacing.four, paddingVertical: Spacing.five, gap: Spacing.three, alignItems: 'center', width: '100%' },
  title: { fontSize: 20, fontWeight: '600', color: Gallery.ink, textAlign: 'center' },
  body: { fontSize: 15, lineHeight: 22, color: Gallery.muted, textAlign: 'center', maxWidth: 320 },
  caption: { fontSize: 14, lineHeight: 21, color: Gallery.muted },
  footer: { padding: Spacing.four, gap: Spacing.two, alignItems: 'center' },
});
