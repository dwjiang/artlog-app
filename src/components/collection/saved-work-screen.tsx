import { Button, Host } from '@expo/ui/swift-ui';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useRouter } from 'expo-router';
import { Alert, ScrollView, StyleSheet } from 'react-native';

import { ArtworkEnrichment } from './artwork-enrichment';
import { NoteEditor } from './note-editor';
import { SnapshotFields } from './snapshot-fields';
import { ThemedView } from '@/components/themed-view';
import { Colors, Spacing } from '@/constants/theme';
import { useLocalOwner } from '@/lib/account/owner-store';
import { selectSavedWork, softDeleteSavedWork } from '@/db/repos/saved-works';
import { SavedWorkImage } from './saved-work-image';

export type SavedWorkScreenProps = {
  savedId: string;
};

export function SavedWorkScreen({ savedId }: SavedWorkScreenProps) {
  const owner = useLocalOwner();
  const router = useRouter();
  const { data } = useLiveQuery(selectSavedWork(savedId, owner), [savedId, owner]);
  const work = data.find((row) => row.owner === owner && row.deletedAt === null);
  if (!work) return <ThemedView style={styles.container} />;

  function confirmDelete() {
    Alert.alert('Delete this work?', 'It leaves your collection. Your photo and note go with it.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { void softDeleteSavedWork(savedId, Date.now(), owner).then(() => router.back()); } },
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
        <SavedWorkImage
          path={work.photoPath ?? work.cropPath}
          title={work.title}
          contain
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
