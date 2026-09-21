import { NotePaper } from '../note-paper';
import { SavedWorkImage } from './saved-work-image';
import { WallSheet } from './wall-sheet';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { selectSavedWork } from '@/db/repos/saved-works';
import { ParagraphSkeleton } from '@/components/loading-skeleton';
import { Image } from 'expo-image';
import { Button, Host } from '@expo/ui/swift-ui';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { MAX_NOTE_LENGTH, NOTE_LENGTH_MESSAGE } from '../../../shared/collection/collection-limits';
import { ThemedText } from '@/components/themed-text';
import { Colors, Fonts, Gallery, Spacing } from '@/constants/theme';
import { useLocalOwner } from '@/lib/account/owner-store';
import { getNote, setNote } from '@/db/repos/notes';
import { GalleryButton } from './gallery-button';

type NoteDraft = {
  owner: string;
  savedLocalId: string;
  text: string;
  saved: string;
  writes: Promise<void>;
  onSaveResult: (failed: boolean) => void;
};

function persist(note: NoteDraft | undefined): void {
  if (!note) return;
  const text = note.text;
  // Serialize blur and close writes so an earlier save cannot overwrite a newer draft.
  note.writes = note.writes.then(async () => {
    try {
      if (text !== note.saved) {
        await setNote(note.savedLocalId, text, Date.now(), note.owner);
        note.saved = text;
      }
      note.onSaveResult(false);
    } catch (error) {
      console.warn('Note not saved', error);
      note.onSaveResult(true);
    }
  });
}

/** The lime swatch and heading shared by every note block, so private and shared notes read the same way. */
export function NoteHeading({ title, children }: { title: string; children?: React.ReactNode }) {
  return <View style={styles.heading}>

    <ThemedText accessibilityRole="header" style={styles.title}>{title}</ThemedText>
    {children}
  </View>;
}

// Saves on blur and when the screen closes mid-edit.
export function NoteEditor({ savedLocalId, sharedOnWall, initiallyEditing = false }: { savedLocalId: string; sharedOnWall?: boolean; initiallyEditing?: boolean }) {
  const owner = useLocalOwner();
  return <WorkNoteEditor key={`${owner}:${savedLocalId}:${initiallyEditing}`} savedLocalId={savedLocalId} owner={owner} sharedOnWall={sharedOnWall} initiallyEditing={initiallyEditing} />;
}

function WorkNoteEditor({ savedLocalId, owner, sharedOnWall, initiallyEditing }: { savedLocalId: string; owner: string; sharedOnWall?: boolean; initiallyEditing: boolean }) {
  const work = useLiveQuery(selectSavedWork(savedLocalId, owner), [savedLocalId, owner]).data[0];
  const [draft, setDraft] = useState<string>();
  const [savedText, setSavedText] = useState('');
  const [saveFailed, setSaveFailed] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [editing, setEditing] = useState(initiallyEditing);
  const latest = useRef<NoteDraft>(undefined);

  useEffect(() => {
    let active = true;
    const note: NoteDraft = {
      owner, savedLocalId, text: '', saved: '', writes: Promise.resolve(),
      onSaveResult: (failed) => { if (active) { setSaveFailed(failed); if (!failed) setSavedText(note.saved); } },
    };
    getNote(savedLocalId, owner).then((row) => {
      if (!active) return;
      note.text = note.saved = row?.text ?? '';
      latest.current = note;
      setDraft(note.text); setSavedText(note.saved);
    }, () => { if (active) setLoadFailed(true); });
    return () => {
      active = false;
      persist(note);
      latest.current = undefined;
    };
  }, [savedLocalId, owner]);

  return (
    <View style={styles.section}>
      <NoteHeading title="Notes">
        {editing ? <GalleryButton label="Done" accessibilityLabel="Done editing note" onPress={() => { persist(latest.current); setEditing(false); }} />
          : <GalleryButton label={draft ? 'Edit' : 'Add'} accessibilityLabel={draft ? 'Edit note' : 'Add note'} disabled={draft === undefined} onPress={() => setEditing(true)} />}
      </NoteHeading>
      {loadFailed ? <ThemedText accessibilityRole="alert" themeColor="error">Your note could not load. Reopen this artwork to try again.</ThemedText>
        : draft === undefined ? <ParagraphSkeleton label="Loading your note…" /> : null}
      {editing && draft !== undefined && <WallSheet title="Notes" tall onDismiss={() => { persist(latest.current); setEditing(false); }}><ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={{ padding: 24, gap: 16 }}>
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center', paddingBottom: 18, borderBottomWidth: 0.5, borderBottomColor: Gallery.separator }}><SavedWorkImage path={work?.cropPath ?? null} title={work?.title ?? 'Artwork'} contain style={{ width: 44, height: 52 }} /><View style={{ flex: 1, gap: 3 }}><ThemedText variant="secondary" style={{ fontWeight: '600' }}>{work?.title}</ThemedText><ThemedText variant="metadata" themeColor="textSecondary">{work?.artist}</ThemedText></View></View>
        <ThemedText variant="metadata" themeColor="textSecondary" style={{ letterSpacing: 1 }}>WHAT STAYED WITH YOU?</ThemedText>
        <TextInput autoFocus
        accessibilityLabel="Notes"
        placeholder="What stayed with you?"
        placeholderTextColor={Colors.light.textSecondary}
        multiline
        maxLength={MAX_NOTE_LENGTH}
        editable={draft !== undefined}
        value={draft ?? ''}
        onChangeText={(text) => {
          if (!latest.current) return;
          latest.current.text = text;
          setDraft(text);
        }}
        onBlur={() => persist(latest.current)}
        style={styles.input}
      />
      <View style={{ padding: 12, backgroundColor: '#EEF2FF' }}><ThemedText variant="metadata">Private note. You can choose to show it on your wall later.</ThemedText></View>
      {draft?.length === MAX_NOTE_LENGTH && <ThemedText themeColor="textSecondary" style={styles.body}>{NOTE_LENGTH_MESSAGE}</ThemedText>}
        <ThemedText themeColor="textSecondary">{saveFailed ? 'Couldn’t save. Your draft is still here.' : draft === savedText ? 'Saved on this iPhone' : 'Saves when you close'}</ThemedText>
        {saveFailed && <GalleryButton label="Retry save" onPress={() => persist(latest.current)} />}
      </ScrollView></WallSheet>}
      {draft !== undefined && <NotePaper label="A moment to keep">
        {draft ? <ThemedText selectable style={styles.body}>{draft}</ThemedText>
          : <ThemedText themeColor="textSecondary" style={styles.body}>What stayed with you? Add a private note.</ThemedText>}
      </NotePaper>}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Image source={sharedOnWall ? 'sf:globe' : 'sf:lock'} tintColor={Gallery.muted} style={{ width: 13, height: 13 }} accessible={false} />
        <ThemedText style={{ color: Gallery.muted, fontSize: 13, lineHeight: 18 }}>{sharedOnWall === true ? 'Shared on your public wall' : sharedOnWall === false || !owner.startsWith('account:') ? 'Only you' : 'Private unless shared on your wall'}</ThemedText>
      </View>
      {saveFailed && !editing ? (
        <View>
          <ThemedText themeColor="textSecondary">Your note couldn’t be saved. Try again.</ThemedText>
          <Host matchContents colorScheme="light">
            <Button label="Retry save" onPress={() => persist(latest.current)} />
          </Host>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  title: { flex: 1, fontFamily: Fonts.display, fontSize: 20, lineHeight: 24, color: Gallery.ink },
  body: { fontSize: 15, lineHeight: 21 },
  input: {
    minHeight: 110, padding: Spacing.three, borderRadius: 2, borderWidth: 1, borderColor: Gallery.softBorder, backgroundColor: Gallery.surface,
    color: Colors.light.text, fontFamily: Fonts.sans, fontSize: 17, lineHeight: 24, textAlignVertical: 'top',
  },
});
