import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, TextInput, View } from 'react-native';
import { ThemedText as Text } from '@/components/themed-text';
import { Gallery } from '@/constants/theme';
import { patchVisit } from '@/db/repos/visits';
import { requestCollectionSync } from '@/lib/account/sync-events';
import type { Visit } from '@/db/schema';
import { LIMITS } from '@/shared/journal/limits';
import { socialErrorMessage } from '@/shared/social/errors';
import { GalleryButton } from '../collection/gallery-button';
import { HighlightHeading } from '../highlight-heading';
import { visitStyles as styles } from './visit-ui';

type NotesVisit = Pick<Visit, 'localId' | 'owner' | 'reflection'>;
type NoteDraft = {
  localId: string; owner: string;
  text: string; savedText: string; unsynced: boolean; focused: boolean;
  timer?: ReturnType<typeof setTimeout>;
  writes: Promise<void>; pending: number;
  onResult: (error?: string) => void;
};

// Typing pauses save locally only: every sync request spends a rate-limited round trip, so blur, background and close push the note.
function persist(note: NoteDraft, sync = true) {
  clearTimeout(note.timer);
  const text = note.text;
  if (!note.pending && text === note.savedText && !(sync && note.unsynced)) return;
  note.pending++;
  // A slower earlier save must not overwrite the latest draft.
  note.writes = note.writes.then(async () => {
    try {
      if (text !== note.savedText) {
        await patchVisit(note.localId, { reflection: text.trim() || null }, note.owner, { sync });
        note.savedText = text;
        note.unsynced = !sync;
      } else if (sync && note.unsynced) {
        requestCollectionSync();
        note.unsynced = false;
      }
      note.onResult();
    } catch (cause) {
      note.onResult(socialErrorMessage(cause) ?? 'Your note could not be saved. Try again.');
    } finally { note.pending--; }
  });
}

export function VisitNotes({ visit }: { visit: NotesVisit }) {
  return <NoteField key={`${visit.owner}:${visit.localId}`} visit={visit} />;
}

function NoteField({ visit }: { visit: NotesVisit }) {
  const [draft, setDraft] = useState(visit.reflection ?? '');
  const [error, setError] = useState<string>();
  const latest = useRef<NoteDraft>({
    localId: visit.localId, owner: visit.owner, text: visit.reflection ?? '', savedText: visit.reflection ?? '', unsynced: false, focused: false,
    writes: Promise.resolve(), pending: 0, onResult: setError,
  });

  useEffect(() => {
    const note = latest.current;
    note.onResult = setError;
    const subscription = AppState.addEventListener('change', (state) => { if (state !== 'active') persist(note); });
    return () => { subscription.remove(); note.onResult = () => {}; persist(note); };
  }, []);
  useFocusEffect(useCallback(() => () => persist(latest.current), []));
  useEffect(() => {
    const note = latest.current;
    if (!note.focused && note.text === note.savedText) {
      note.text = note.savedText = visit.reflection ?? '';
      setDraft(note.text);
    }
  }, [visit.reflection]);

  return <View>
    <View style={styles.sectionLabel}><HighlightHeading>Notes</HighlightHeading></View>
    <TextInput keyboardAppearance="light" selectionColor={Gallery.accent} placeholderTextColor={Gallery.muted}
      accessibilityLabel="Notes" placeholder="What stayed with you?" value={draft}
      onFocus={() => { latest.current.focused = true; }}
      onChangeText={(text) => {
        const note = latest.current;
        note.text = text; setDraft(text); clearTimeout(note.timer);
        note.timer = setTimeout(() => persist(note, false), 500);
      }}
      onBlur={() => { latest.current.focused = false; persist(latest.current); }}
      multiline maxLength={LIMITS.note} style={[styles.input, styles.reflection]} />
    {error && <View>
      <Text accessibilityRole="alert" style={styles.error}>{error}</Text>
      <GalleryButton label="Retry save" onPress={() => persist(latest.current)} />
    </View>}
  </View>;
}
