import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Gallery, Radius, Spacing, Typography } from '@/constants/theme';
import { ThemedText } from '../themed-text';

export function CollectionSearchField({ value, label, placeholder = label, onChange, onClear }: {
  value: string; label: string; placeholder?: string; onChange: (value: string) => void; onClear: () => void;
}) {
  const [focused, setFocused] = useState(false);
  return <View style={{ gap: Spacing.two }}>
    <ThemedText variant="metadata">{label}</ThemedText>
    <View style={[styles.field, { borderColor: focused ? Gallery.accent : Gallery.controlBorder }]}>
      <Image source="sf:magnifyingglass" tintColor={Gallery.muted} style={{ width: 17, height: 17 }} accessible={false} />
      <TextInput value={value} onChangeText={onChange} placeholder={placeholder} accessibilityLabel={label} autoCapitalize="none"
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} keyboardAppearance="light" selectionColor={Gallery.accent}
        placeholderTextColor={Gallery.muted} autoCorrect={false} returnKeyType="search" clearButtonMode="never" style={styles.input} />
      {!!value && <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={onClear}
        style={({ pressed }) => [styles.clear, { opacity: pressed ? 0.6 : 1 }]}>
        <Image source="sf:xmark.circle.fill" tintColor={Gallery.accent} style={{ width: 19, height: 19 }} accessible={false} />
      </Pressable>}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  field: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingLeft: Spacing.compact, paddingRight: Spacing.one,
    borderRadius: Radius.input, borderCurve: 'continuous', borderWidth: 1, backgroundColor: Gallery.surface },
  input: { flex: 1, minHeight: 44, paddingVertical: Spacing.two, ...Typography.body, color: Gallery.ink },
  clear: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});
