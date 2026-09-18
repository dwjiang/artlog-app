import { Image } from 'expo-image';
import { useState } from 'react';
import { View } from 'react-native';
import { ThemedText as Text } from '@/components/themed-text';
import { initials } from '@/lib/social/presentation';

import { Gallery } from '@/constants/theme';

export function ProfileAvatar({ name, photoUrl, size = 40 }: { name: string; photoUrl?: string; size?: number }) {
  const [failed, setFailed] = useState<string>();
  const letters = initials(name);
  return <View accessibilityElementsHidden style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden',
    backgroundColor: Gallery.avatar, alignItems: 'center', justifyContent: 'center' }}>
    {photoUrl && failed !== photoUrl ? <Image source={photoUrl} contentFit="cover" onError={() => setFailed(photoUrl)} style={{ width: size, height: size }} />
      : <Text allowFontScaling={false} style={{ fontSize: size * 0.3, fontWeight: '600', letterSpacing: 0.4, color: Gallery.ink }}>{letters}</Text>}
  </View>;
}
