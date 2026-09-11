import { Button, Host } from '@expo/ui/swift-ui';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Alert, ScrollView, StyleSheet } from 'react-native';

import { ArtworkEnrichment } from './artwork-enrichment';
import { NoteEditor } from './note-editor';
import { SnapshotFields } from './snapshot-fields';
import { ThemedView } from '@/components/themed-view';
import { Colors, Spacing } from '@/constants/theme';
import { selectSavedWork, softDeleteSavedWork } from '@/db/repos/saved-works';
import { captureFileUri } from '@/lib/files/photos';

export type SavedWorkScreenProps = {
  savedId: string;
};

export function SavedWorkScreen({ savedId }: SavedWorkScreenProps) {
  const router = useRouter();
  const { data } = useLiveQuery(selectSavedWork(savedId), [savedId]);
  const work = data[0];
  if (!work) return <ThemedView style={styles.container} />;

  function confirmDelete() {
    Alert.alert('Delete this work?', 'It leaves your collection. Your photo and note go with it.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { void softDeleteSavedWork(savedId).then(() => router.back()); } },
    ]);
  }

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode="interactive"
        contentContainerStyle={styles.content}
      >
        <Image
          source={captureFileUri(work.photoPath ?? work.cropPath)}
          contentFit="contain"
          accessibilityLabel={`Your photo of ${work.title}`}
          style={styles.photo}
        />
        <SnapshotFields work={work} />
        <NoteEditor savedLocalId={work.localId} />
        {work.artworkId ? <ArtworkEnrichment artworkId={work.artworkId} /> : null}
        <Host matchContents colorScheme="light">
          <Button role="destructive" label="Delete" onPress={confirmDelete} />
        </Host>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.four },
  photo: { width: '100%', aspectRatio: 1, borderRadius: Spacing.two, backgroundColor: Colors.light.backgroundElement },
});
