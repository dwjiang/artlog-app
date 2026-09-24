import { Switch } from "@expo/ui";
import { getPermissionsAsync } from "expo-media-library";
import { useEffect, useRef, useState } from "react";

import { GroupedFooter, GroupedSection, ValueRow } from "@/components/grouped-list";
import { reportError } from "@/lib/observability";
import { getSaveToPhotos, setSaveToPhotos } from "@/lib/settings/save-to-photos";

export function PhotoLibraryPreference() {
  const [enabled, setEnabled] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string>();
  const saving = useRef(false);
  useEffect(() => {
    let active = true;
    void getSaveToPhotos()
      .then((value) => {
        if (active) setEnabled(value);
      })
      .catch((cause) => {
        reportError(cause, "settings.save-to-photos.load");
        if (active) setError("The preference could not load.");
      })
      .finally(() => {
        if (active) setLoaded(true);
      });
    void getPermissionsAsync(true).then(
      ({ status }) => {
        if (active) setDenied(status === "denied");
      },
      (cause: unknown) => reportError(cause, "settings.save-to-photos.permission", { level: "warning" }),
    );
    return () => {
      active = false;
    };
  }, []);
  // The local write lands within a frame or two, so the switch flips at once instead of flashing a disabled state.
  async function change(value: boolean) {
    if (saving.current) return;
    saving.current = true;
    setEnabled(value);
    setError(undefined);
    try {
      await setSaveToPhotos(value);
    } catch (cause) {
      reportError(cause, "settings.save-to-photos.save");
      setEnabled(!value);
      setError("The preference could not be saved.");
    } finally {
      saving.current = false;
    }
  }
  const footer =
    error
    ?? (enabled && denied
      ? "Artlog can’t add photos to your library. Allow it in the Settings app under Privacy & Security > Photos."
      : "When you save an artwork, the full-size photos you took with Artlog go to your photo library. Artlog keeps a smaller copy.");
  return (
    <GroupedSection footer={<GroupedFooter tone={error ? "destructive" : "muted"}>{footer}</GroupedFooter>}>
      {!loaded ? (
        <ValueRow label="Save to Photos" loading />
      ) : (
        <Switch
          label="Save to Photos"
          value={enabled}
          onValueChange={(value) => {
            void change(value);
          }}
        />
      )}
    </GroupedSection>
  );
}
