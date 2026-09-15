import { StyleSheet } from 'react-native';
import { Gallery, Spacing } from '@/constants/theme';

export const socialStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Gallery.paper },
  content: { paddingBottom: Spacing.four, flexGrow: 1 },
  section: { padding: Spacing.four, gap: Spacing.three },
  state: { paddingHorizontal: Spacing.four, paddingVertical: Spacing.five, gap: Spacing.three, alignItems: 'flex-start' },
  title: { fontSize: 24, fontWeight: '600', color: Gallery.ink },
  body: { fontSize: 17, lineHeight: 25, color: Gallery.ink },
  caption: { fontSize: 14, lineHeight: 21, color: Gallery.muted },
  footer: { padding: Spacing.four, gap: Spacing.two, alignItems: 'center' },
});
