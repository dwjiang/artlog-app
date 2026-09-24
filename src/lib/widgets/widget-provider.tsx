import { eq } from "drizzle-orm";
import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { createContext, use, useEffect, useMemo, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { db } from "@/db/client";
import { selectAllArtworkPhotos, selectArtworkEncounters } from "@/db/repos/artwork-album";
import { listSavedWorks } from "@/db/repos/saved-works";
import { listVisits } from "@/db/repos/visits";
import { settings as settingsTable } from "@/db/schema";
import { getLocalOwner, subscribeOwnerChange, useLocalOwner } from "@/lib/account/owner-store";
import { widgetCollection, type PreparedWidgetArtwork, type WidgetArtwork } from "./widget-collection";
import { createWidgetPublisher } from "./widget-publisher";
import { readWidgetSettings, widgetSettingsKey, type WidgetSettings } from "./widget-settings";
import {
  clearWidgetCollection,
  prepareWidgetArtwork,
  prepareWidgetFont,
  pruneWidgetImages,
  writeWidgetManifest,
} from "./widget-storage";

function useWidgetState(owner: string) {
  const works = useLiveQuery(listSavedWorks(owner), [owner]);
  const visits = useLiveQuery(listVisits(owner), [owner]);
  const encounters = useLiveQuery(selectArtworkEncounters(owner), [owner]);
  const photos = useLiveQuery(selectAllArtworkPhotos(owner), [owner]);
  const [preferences, setPreferences] = useState(() =>
    readWidgetSettings(
      db
        .select()
        .from(settingsTable)
        .where(eq(settingsTable.key, widgetSettingsKey(owner)))
        .get()?.value,
    ),
  );
  const [prepared, setPrepared] = useState<PreparedWidgetArtwork[]>([]);
  const [error, setError] = useState<string>();
  const [settled, setSettled] = useState<{
    artworks: WidgetArtwork[];
    preferences: WidgetSettings;
    revision: number;
  }>();
  const [revision, refresh] = useState(0);
  const [publisher] = useState(() =>
    createWidgetPublisher({
      prepare: prepareWidgetArtwork,
      write: writeWidgetManifest,
      prune: pruneWidgetImages,
      currentOwner: getLocalOwner,
    }),
  );
  const allArtworks = useMemo(
    () =>
      widgetCollection(owner, works.data, visits.data, encounters.data, photos.data, {
        kind: "collection",
      }),
    [owner, works.data, visits.data, encounters.data, photos.data],
  );
  const artworks = useMemo(
    () => widgetCollection(owner, works.data, visits.data, encounters.data, photos.data, preferences.source),
    [owner, works.data, visits.data, encounters.data, photos.data, preferences.source],
  );
  const queryError = works.error ?? visits.error ?? encounters.error ?? photos.error;
  const loading = !queryError && (!works.updatedAt || !visits.updatedAt || !encounters.updatedAt || !photos.updatedAt);
  const syncing =
    !loading
    && !queryError
    && (settled?.artworks !== artworks || settled.preferences !== preferences || settled.revision !== revision);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh((value) => value + 1);
    });
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (loading || queryError) return;
    let cancelled = false;
    void (async () => {
      try {
        await prepareWidgetFont();
        if (cancelled) return;
        const result = await publisher.publish(owner, artworks, preferences);
        if (!cancelled && result) {
          setPrepared(result);
          setError(undefined);
        }
      } catch {
        if (!cancelled) setError("Your widget could not update. Try again.");
      } finally {
        if (!cancelled) setSettled({ artworks, preferences, revision });
      }
    })();
    return () => {
      cancelled = true;
      publisher.cancel();
    };
  }, [owner, artworks, preferences, loading, queryError, revision, publisher]);

  function update(patch: Partial<WidgetSettings>) {
    if (getLocalOwner() !== owner) return;
    const next = { ...preferences, ...patch };
    try {
      db.insert(settingsTable)
        .values({ key: widgetSettingsKey(owner), value: JSON.stringify(next) })
        .onConflictDoUpdate({
          target: settingsTable.key,
          set: { value: JSON.stringify(next) },
        })
        .run();
      setPreferences(next);
      setError(undefined);
    } catch {
      setError("Your widget settings could not be saved. Try again.");
    }
  }
  const ready = prepared.flatMap((artwork) => {
    const current = artworks.find((row) => row.id === artwork.id);
    return current ? [{ ...artwork, ...current }] : [];
  });
  return {
    owner,
    preferences,
    update,
    artworks,
    allArtworks,
    prepared: ready,
    works: works.data.filter((row) => row.owner === owner),
    visits: visits.data.filter((row) => row.owner === owner),
    encounters: encounters.data.filter((row) => row.owner === owner),
    loading,
    syncing,
    error: queryError ? "Your collection could not be loaded." : error,
    retry: () => refresh((value) => value + 1),
  };
}

const WidgetContext = createContext<ReturnType<typeof useWidgetState> | undefined>(undefined);
function OwnerWidgetProvider({ owner, children }: { owner: string; children: ReactNode }) {
  const value = useWidgetState(owner);
  return <WidgetContext value={value}>{children}</WidgetContext>;
}
export function WidgetProvider({ children }: { children: ReactNode }) {
  const owner = useLocalOwner();
  useEffect(
    () =>
      subscribeOwnerChange(() => {
        try {
          clearWidgetCollection();
        } catch {
          /* The next collection refresh retries unavailable native storage. */
        }
      }),
    [],
  );
  return (
    <OwnerWidgetProvider key={owner} owner={owner}>
      {children}
    </OwnerWidgetProvider>
  );
}
export function useWidgetCollection() {
  const value = use(WidgetContext);
  if (!value) throw new Error("WidgetProvider is missing");
  return value;
}
