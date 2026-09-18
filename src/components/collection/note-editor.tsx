import { Button, Host } from '@expo/ui/swift-ui';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

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
    <View style={styles.swatch} />
    <ThemedText accessibilityRole="header" style={styles.title}>{title}</ThemedText>
    {children}
  </View>;
}

// Saves on blur and when the screen closes mid-edit.
export function NoteEditor({ savedLocalId }: { savedLocalId: string }) {
  const owner = useLocalOwner();
  return <WorkNoteEditor key={`${owner}:${savedLocalId}`} savedLocalId={savedLocalId} owner={owner} />;
}

function WorkNoteEditor({ savedLocalId, owner }: { savedLocalId: string; owner: string }) {
  const [draft, setDraft] = useState<string>();
  const [saveFailed, setSaveFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const latest = useRef<NoteDraft>(undefined);

  useEffect(() => {
    let active = true;
    const note: NoteDraft = {
      owner, savedLocalId, text: '', saved: '', writes: Promise.resolve(),
      onSaveResult: (failed) => { if (active) setSaveFailed(failed); },
    };
    getNote(savedLocalId, owner).then((row) => {
      if (!active) return;
      note.text = note.saved = row?.text ?? '';
      latest.current = note;
      setDraft(note.text);
    }, (error: unknown) => console.warn('Note not loaded', error));
    return () => {
      active = false;
      persist(note);
      latest.current = undefined;
    };
  }, [savedLocalId, owner]);

  return (
    <View style={styles.section}>
      <NoteHeading title="Your note">
        {editing ? <GalleryButton label="Done" accessibilityLabel="Done editing note" onPress={() => { persist(latest.current); setEditing(false); }} />
          : <GalleryButton label={draft ? 'Edit' : 'Add'} accessibilityLabel={draft ? 'Edit note' : 'Add note'} disabled={draft === undefined} onPress={() => setEditing(true)} />}
      </NoteHeading>
      {editing ? <><TextInput
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
      {draft?.length === MAX_NOTE_LENGTH && <ThemedText themeColor="textSecondary" style={styles.body}>{NOTE_LENGTH_MESSAGE}</ThemedText>}
      </> : draft ? <ThemedText selectable style={styles.body}>{draft}</ThemedText>
        : <ThemedText themeColor="textSecondary" style={styles.body}>Keep a private note about this work.</ThemedText>}
      {saveFailed ? (
        <View style={styles.body}>
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
  swatch: { width: 14, height: 14, backgroundColor: Gallery.highlight },
  title: { flex: 1, fontSize: 17, lineHeight: 22, fontWeight: '600', color: Gallery.ink },
  body: { marginLeft: 24 },
  input: {
    marginLeft: 24, minHeight: 96, padding: Spacing.three, borderRadius: Spacing.two, backgroundColor: Colors.light.backgroundElement,
    color: Colors.light.text, fontFamily: Fonts.sans, fontSize: 17, lineHeight: 24, textAlignVertical: 'top',
  },
});
