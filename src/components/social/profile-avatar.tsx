import { Image } from 'expo-image';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { initials } from '@/lib/social/presentation';

const colors = [
  { background: '#DDE1D0', ink: '#67714D' }, { background: '#E6DACB', ink: '#79614C' },
  { background: '#D6DEE3', ink: '#4F6573' }, { background: '#E4D6D7', ink: '#7B5D62' },
];

export function ProfileAvatar({ name, photoUrl, size = 40 }: { name: string; photoUrl?: string; size?: number }) {
  const [failed, setFailed] = useState<string>();
  const letters = initials(name), color = colors[(letters.codePointAt(0) ?? 0) % colors.length];
  return <View accessibilityElementsHidden style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden',
    backgroundColor: color.background, alignItems: 'center', justifyContent: 'center', borderWidth: 0.5, borderColor: '#2623200B' }}>
    {photoUrl && failed !== photoUrl ? <Image source={photoUrl} contentFit="cover" onError={() => setFailed(photoUrl)} style={{ width: size, height: size }} />
      : <Text style={{ fontSize: size * 0.3, fontWeight: '600', letterSpacing: 0.4, color: color.ink }}>{letters}</Text>}
  </View>;
}
