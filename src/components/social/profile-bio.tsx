import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Gallery } from '@/constants/theme';
export function ProfileBio({ text }: { text?: string }) {
  const [expanded, setExpanded] = useState(false), [long, setLong] = useState(false);
  if (!text) return null;
  return <View style={{ gap: 4 }}><Text style={{ position: 'absolute', opacity: 0, fontSize: 13, lineHeight: 20 }} accessibilityElementsHidden onTextLayout={(event) => setLong(event.nativeEvent.lines.length > 2)}>{text}</Text>
    <Text selectable numberOfLines={expanded ? undefined : 2} style={{ fontSize: 13, lineHeight: 20, color: Gallery.muted }}>{text}</Text>
    {long && <Pressable accessibilityRole="button" onPress={() => setExpanded(!expanded)}><Text style={{ color: Gallery.accent, fontSize: 12, paddingVertical: 5 }}>{expanded ? 'Show less' : 'Read more'}</Text></Pressable>}
  </View>;
}
