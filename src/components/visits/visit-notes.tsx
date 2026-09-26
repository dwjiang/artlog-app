import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { AppState, StyleSheet, TextInput, View } from "react-native";

import { GalleryButton } from "@/components/collection/gallery-button";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, Radius, Spacing } from "@/constants/theme";
import { patchVisit } from "@/db/repos/visits";
import type { Visit } from "@/db/schema";
import { requestCollectionSync } from "@/lib/account/sync-events";
import { reportError } from "@/lib/observability";
import { LIMITS } from "@/shared/journal/limits";
import { socialErrorMessage } from "@/shared/social/errors";

import { visitStyles as styles } from "./visit-ui";

type NotesVisit = Pick<Visit, "localId" | "owner" | "reflection">;
export type VisitNotesHandle = { save: () => Promise<boolean> };
type VisitNotesProps = {
  visit: NotesVisit;
  /** Saves as the person types and on blur; off, the field stays open and saves only through the handle. */
  autoSave?: boolean;
  editable?: boolean;
  grouped?: boolean;
  ref?: Ref<VisitNotesHandle>;
};
type NoteDraft = {
  localId: string;
  owner: string;
  text: string;
  savedText: string;
  unsynced: boolean;
  focused: boolean;
  timer?: ReturnType<typeof setTimeout>;
  writes: Promise<boolean>;
  pending: number;
  onResult: (error?: string) => void;
};

// Typing pauses save locally only: every sync request spends a rate-limited round trip, so blur, background and close push the note.
function persist(note: NoteDraft, sync = true) {
  clearTimeout(note.timer);
  const { text } = note;
  if (!note.pending && text === note.savedText && !(sync && note.unsynced)) {
    return Promise.resolve(true);
  }
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
      return true;
    } catch (cause) {
      reportError(cause, "visit.note.save");
      note.onResult(socialErrorMessage(cause) ?? "Your note could not be saved. Try again.");
      return false;
    } finally {
      note.pending--;
    }
  });
  return note.writes;
}

export function VisitNotes({ visit, ...props }: VisitNotesProps) {
  return <NoteField key={`${visit.owner}:${visit.localId}`} visit={visit} {...props} />;
}

function NoteField({ visit, autoSave = true, editable = true, grouped = false, ref }: VisitNotesProps) {
  const [draft, setDraft] = useState(visit.reflection ?? "");
  const [editing, setEditing] = useState(!autoSave);
  const [error, setError] = useState<string>();
  const latest = useRef<NoteDraft>({
    localId: visit.localId,
    owner: visit.owner,
    text: visit.reflection ?? "",
    savedText: visit.reflection ?? "",
    unsynced: false,
    focused: false,
    writes: Promise.resolve(true),
    pending: 0,
    onResult: setError,
  });
  useImperativeHandle(ref, () => ({ save: () => persist(latest.current) }), []);

  useEffect(() => {
    const note = latest.current;
    note.onResult = setError;
    const subscription = autoSave
      ? AppState.addEventListener("change", (state) => {
          if (state !== "active") void persist(note);
        })
      : undefined;
    return () => {
      subscription?.remove();
      note.onResult = () => {};
      clearTimeout(note.timer);
      if (autoSave) void persist(note);
    };
  }, [autoSave]);
  useFocusEffect(
    useCallback(
      () => () => {
        if (autoSave) void persist(latest.current);
      },
      [autoSave],
    ),
  );
  useEffect(() => {
    const note = latest.current;
    if (!note.focused && note.text === note.savedText) {
      note.text = note.savedText = visit.reflection ?? "";
      setDraft(note.text);
    }
  }, [visit.reflection]);

  return (
    <View style={{ gap: 8 }}>
      <View style={notes.header}>
        <Text accessibilityRole="header" style={grouped ? notes.title : styles.eyebrow}>
          Notes
        </Text>
        {autoSave && (
          <GalleryButton
            label={editing ? "Done" : draft ? "Edit" : "Add"}
            accessibilityLabel={editing ? "Save note" : draft ? "Edit note" : "Add a note"}
            disabled={!editable}
            onPress={() => {
              if (editing) void persist(latest.current);
              setEditing(!editing);
            }}
          />
        )}
      </View>
      {editing ? (
        <TextInput
          keyboardAppearance="light"
          selectionColor={Gallery.accent}
          placeholderTextColor={Gallery.muted}
          accessibilityLabel="Notes"
          placeholder="Add a note about this visit…"
          value={draft}
          editable={editable}
          onFocus={() => {
            latest.current.focused = true;
          }}
          onChangeText={(text) => {
            const note = latest.current;
            note.text = text;
            setDraft(text);
            clearTimeout(note.timer);
            if (autoSave) {
              note.timer = setTimeout(() => {
                void persist(note, false);
              }, 500);
            }
          }}
          onBlur={() => {
            latest.current.focused = false;
            if (autoSave) void persist(latest.current);
          }}
          autoFocus={autoSave}
          multiline
          maxLength={LIMITS.note}
          style={[styles.input, styles.reflection, grouped && notes.card]}
        />
      ) : draft ? (
        <Text selectable style={[styles.body, grouped && notes.card]}>
          {draft}
        </Text>
      ) : (
        <Text style={[styles.caption, grouped && notes.card]}>No notes yet.</Text>
      )}
      {error && (
        <View>
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
          {autoSave && (
            <GalleryButton
              label="Retry save"
              onPress={() => {
                void persist(latest.current);
              }}
            />
          )}
        </View>
      )}
    </View>
  );
}

const notes = StyleSheet.create({
  title: { fontSize: 20, lineHeight: 25, fontWeight: "600", color: Gallery.ink },
  card: {
    borderWidth: 0,
    borderRadius: Radius.sheet,
    backgroundColor: Gallery.surface,
    padding: Spacing.three,
    minHeight: 104,
    fontSize: 17,
    lineHeight: 24,
  },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44 },
});
