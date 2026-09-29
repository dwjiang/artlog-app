import { useEffect, useRef, useState } from "react";

import { getNote, setNote } from "@/db/repos/notes";
import { reportError } from "@/lib/observability";

type NoteDraft = {
  owner: string;
  savedLocalId: string;
  text: string;
  saved: string;
  writes: Promise<boolean>;
  onSaveResult: (failed: boolean) => void;
};

function persist(note: NoteDraft | undefined): Promise<boolean> {
  if (!note) return Promise.resolve(true);
  const { text } = note;
  // Serialize blur and close writes so an earlier save cannot overwrite a newer draft.
  note.writes = note.writes.then(async () => {
    try {
      if (text !== note.saved) {
        await setNote(note.savedLocalId, text, Date.now(), note.owner);
        note.saved = text;
      }
      note.onSaveResult(false);
      return true;
    } catch (error) {
      reportError(error, "collection.note.save");
      note.onSaveResult(true);
      return false;
    }
  });
  return note.writes;
}

export function useArtworkNote(savedLocalId: string, owner: string) {
  const [draft, setDraft] = useState<string>();
  const [savedText, setSavedText] = useState("");
  const [saveFailed, setSaveFailed] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const latest = useRef<NoteDraft>(undefined);

  useEffect(() => {
    let active = true;
    const note: NoteDraft = {
      owner,
      savedLocalId,
      text: "",
      saved: "",
      writes: Promise.resolve(true),
      onSaveResult: (failed) => {
        if (active) {
          setSaveFailed(failed);
          if (!failed) setSavedText(note.saved);
        }
      },
    };
    getNote(savedLocalId, owner).then(
      (row) => {
        if (!active) return;
        note.text = note.saved = row?.text ?? "";
        latest.current = note;
        setDraft(note.text);
        setSavedText(note.saved);
      },
      (cause) => {
        reportError(cause, "collection.note.load");
        if (active) setLoadFailed(true);
      },
    );
    return () => {
      active = false;
      void persist(note);
      latest.current = undefined;
    };
  }, [savedLocalId, owner]);

  return {
    draft,
    savedText,
    saveFailed,
    loadFailed,
    setDraft: (text: string) => {
      if (!latest.current) return;
      latest.current.text = text;
      setDraft(text);
    },
    save: () => persist(latest.current),
  };
}
