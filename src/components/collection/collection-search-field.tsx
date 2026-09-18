import { Image } from 'expo-image';
import { Pressable, TextInput, View } from 'react-native';
import { Gallery } from '@/constants/theme';

export function CollectionSearchField({ value, label, placeholder = label, onChange, onClear }: {
  value: string; label: string; placeholder?: string; onChange: (value: string) => void; onClear: () => void;
}) {
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 9, borderRadius: 10, backgroundColor: Gallery.fill }}>
    <Image source="sf:magnifyingglass" tintColor={Gallery.muted} style={{ width: 16, height: 16 }} />
    <TextInput value={value} onChangeText={onChange} placeholder={placeholder} accessibilityLabel={label} autoCapitalize="none"
      autoCorrect={false} returnKeyType="search" clearButtonMode="never" style={{ flex: 1, minHeight: 38, paddingVertical: 8, fontSize: 14, color: Gallery.ink }} />
    {!!value && <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={onClear} hitSlop={10} style={{ paddingVertical: 10 }}>
      <Image source="sf:xmark.circle.fill" tintColor={Gallery.muted} style={{ width: 16, height: 16 }} />
    </Pressable>}
  </View>;
}
