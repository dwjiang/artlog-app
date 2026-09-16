import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Gallery } from '@/constants/theme';
import type { CaptureCompletion as Completion } from '@/lib/capture/completion';
import { captureFileUri } from '@/lib/files/photos';
import { GalleryButton } from '../collection/gallery-button';

export function CaptureCompletion({ completion, onViewResult, inline = false, sharedToIndex = false }: { completion: Completion; onViewResult?: () => void; inline?: boolean; sharedToIndex?: boolean }) {
  const router = useRouter();
  const content = <>
    <Image source="sf:checkmark.circle" style={{ width: 42, height: 42 }} tintColor={Gallery.accent} />
    <Text style={styles.title}>Keep this moment.</Text>
    <Text style={styles.copy}>{completion.wasExisting ? 'Added to' : 'Saved as'} {completion.title}.</Text>
    <Text style={styles.copy}>1 artwork · {completion.photoPaths.length} new {completion.photoPaths.length === 1 ? 'photo' : 'photos'}</Text>
    <View style={styles.photos}>{completion.photoPaths.slice(0, 3).map((path) => <Image key={path} source={{ uri: captureFileUri(path) }} contentFit="cover" style={styles.photo} accessibilityLabel="Saved photo preview" />)}</View>
    <Text style={styles.copy}>{completion.visitLabel}</Text>
    <Text style={styles.note}>{completion.wasExisting ? 'Your earlier photos and encounters are unchanged.' : 'A single artwork, with all these photos together.'}</Text>
    <GalleryButton label="Scan next artwork" icon="arrow.right" iconPosition="trailing" variant="filled" fullWidth onPress={() => {
      router.dismissAll();
      router.navigate('/(tabs)/(scan)/scan');
    }} />
    <GalleryButton label="View artwork" fullWidth onPress={() => router.dismissTo({ pathname: '/(tabs)/(collection)/[savedId]', params: { savedId: completion.savedId } })} />
    {onViewResult && <GalleryButton label="View result" fullWidth onPress={onViewResult} />}
    <Text style={styles.note}>{sharedToIndex ? 'An artwork crop was shared with the index.' : 'New photos are private.'} Your wall and shared visits haven’t changed.</Text>
  </>;
  return inline ? <View style={styles.content}>{content}</View> : <ScrollView style={styles.page} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>{content}</ScrollView>;
}
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: Gallery.paper },
  content: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 28, gap: 14 },
  title: { fontFamily: 'Georgia', fontSize: 32, color: Gallery.ink },
  copy: { fontSize: 14, lineHeight: 21, color: Gallery.ink, textAlign: 'center' },
  note: { fontSize: 12, lineHeight: 19, color: Gallery.muted, textAlign: 'center' },
  photos: { flexDirection: 'row', gap: 8, marginVertical: 12, width: '100%' },
  photo: { flex: 1, height: 100, borderRadius: 8, backgroundColor: Gallery.fill },
});
