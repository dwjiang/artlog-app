import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gallery } from '@/constants/theme';

/** A settings line: title, supporting detail, and a chevron for rows that open something or a lock for fixed rules. */
export function SettingsRow({ title, detail, trailing = 'chevron', onPress, disabled = false }: {
  title: string; detail?: string; trailing?: 'chevron' | 'lock' | 'none'; onPress?: () => void; disabled?: boolean;
}) {
  const body = <>
    <View style={styles.copy}>
      <Text style={styles.title}>{title}</Text>
      {detail && <Text style={styles.detail}>{detail}</Text>}
    </View>
    {trailing !== 'none' && <Image source={`sf:${trailing === 'lock' ? 'lock' : 'chevron.right'}`} tintColor={Gallery.muted} style={styles.icon} />}
  </>;
  return onPress ? <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityHint={detail} disabled={disabled}
    onPress={onPress} style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}>{body}</Pressable> : <View style={styles.row}>{body}</View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44, paddingVertical: 12 },
  copy: { flex: 1, gap: 4 },
  title: { fontSize: 14, lineHeight: 20, color: Gallery.ink },
  detail: { fontSize: 11, lineHeight: 17, color: Gallery.muted },
  icon: { width: 14, height: 14 },
});
