import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { AudioIcon } from '@/components/audio/audio-icon';
import { Gallery } from '@/constants/theme';
import { useVenue } from '@/lib/venue/use-venue';
export function VisitBar() {
  const router = useRouter();
  const { visit } = useVenue();
  if (!visit) return null;
  return <Pressable accessibilityRole="button" accessibilityLabel={`Visiting ${visit.venueName}`} accessibilityHint="Opens the current visit"
    onPress={() => router.push({ pathname: '/journal/[visitId]', params: { visitId: visit.localId } })}
    style={({ pressed }) => ({ minHeight: 44, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 8, backgroundColor: Gallery.surface, opacity: pressed ? 0.6 : 1, borderBottomWidth: 0.5, borderColor: Gallery.softBorder })}>
    <AudioIcon name="building.columns" size={15} color={Gallery.muted} />
    <View style={{ flex: 1 }}><ThemedText numberOfLines={1} style={{ fontSize: 12 }}>Visiting · {visit.venueName}</ThemedText></View>
    <AudioIcon name="chevron.right" size={12} color={Gallery.muted} />
  </Pressable>;
}
