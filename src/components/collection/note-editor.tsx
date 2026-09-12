import { Button, Host } from '@expo/ui/swift-ui';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { MAX_NOTE_LENGTH, NOTE_LENGTH_MESSAGE } from '../../../shared/collection-limits';
import { ThemedText } from '@/components/themed-text';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { getNote, setNote } from '@/db/repos/notes';

type NoteDraft = {
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
        await setNote(note.savedLocalId, text);
        note.saved = text;
      }
      note.onSaveResult(false);
    } catch (error) {
      console.warn('Note not saved', error);
      note.onSaveResult(true);
    }
  });
}

/** The only editable part of a saved work; saves on blur and when the screen closes mid-edit. */
export function NoteEditor({ savedLocalId }: { savedLocalId: string }) {
  return <WorkNoteEditor key={savedLocalId} savedLocalId={savedLocalId} />;
}

function WorkNoteEditor({ savedLocalId }: { savedLocalId: string }) {
  const [draft, setDraft] = useState<string>();
  const [saveFailed, setSaveFailed] = useState(false);
  const latest = useRef<NoteDraft>(undefined);

  useEffect(() => {
    let active = true;
    const note: NoteDraft = {
      savedLocalId, text: '', saved: '', writes: Promise.resolve(),
      onSaveResult: (failed) => { if (active) setSaveFailed(failed); },
    };
    getNote(savedLocalId).then((row) => {
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
  }, [savedLocalId]);

  return (
    <View style={styles.section}>
      <ThemedText type="smallBold" themeColor="textSecondary">Notes</ThemedText>
      <TextInput
        accessibilityLabel="Notes"
        placeholder="Add a note about this work"
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
      {draft?.length === MAX_NOTE_LENGTH && <ThemedText themeColor="textSecondary">{NOTE_LENGTH_MESSAGE}</ThemedText>}
      {saveFailed ? (
        <>
          <ThemedText themeColor="textSecondary">Your note couldn’t be saved. Try again.</ThemedText>
          <Host matchContents colorScheme="light">
            <Button label="Retry save" onPress={() => persist(latest.current)} />
          </Host>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two },
  input: {
    minHeight: 96, padding: Spacing.three, borderRadius: Spacing.two, backgroundColor: Colors.light.backgroundElement,
    color: Colors.light.text, fontFamily: Fonts.sans, fontSize: 16, lineHeight: 22, textAlignVertical: 'top',
  },
});
