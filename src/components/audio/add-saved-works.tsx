import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useConvex } from 'convex/react';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { api } from '../../../convex/_generated/api';
import { GalleryButton } from '@/components/collection/gallery-button';
import { ThemedText as Text } from '@/components/themed-text';
import { listSavedWorks } from '@/db/repos/saved-works';
import type { SavedWork } from '@/db/schema';
import { captureOwner, useLocalOwner } from '@/lib/account/owner-store';
import { captureFileUri } from '@/lib/files/photos';
import { useListening } from '@/lib/audio/use-listening';
import { ArtworkThumbnail } from './artwork-thumbnail';
import { Gallery } from '@/constants/theme';
export function AddSavedWorks() {
  const owner = useLocalOwner();
  const { data, updatedAt, error: loadError } = useLiveQuery(listSavedWorks(owner), [owner]);
  const works = data.filter((work) => work.owner === owner && !work.deletedAt);
  const client = useConvex();
  const audio = useListening();
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState<string>();
  async function add(work: SavedWork) {
    if (!work.artworkId || pending) return;
    const scope = captureOwner();
    setPending(work.localId); setError(undefined);
    try {
      const enriched = await client.query(api.artworks.enrichment, { artworkId: work.artworkId });
      if (!scope.isOwnerCurrent()) return;
      if (!enriched?.narrationFacts?.length) { setError(`Narration isn’t available for ${work.title} yet.`); return; }
      audio.controller.enqueue({ work: { artworkId: work.artworkId, title: work.title, artist: work.artist, savedId: work.localId,
        imageUri: work.cropPath ? captureFileUri(work.cropPath) : enriched.thumbnailUrl, facts: enriched.narrationFacts, researchUpdatedAt: enriched.narrationResearchUpdatedAt, opening: enriched.narrationOpening, renderId: enriched.narrationRenderId } });
    } catch { if (scope.isOwnerCurrent()) setError('Couldn’t load narration. Check your connection and try again.'); }
    finally { if (scope.isOwnerCurrent()) setPending(undefined); }
  }
  return <ScrollView contentContainerStyle={{ padding: 24, gap: 12 }}>
    <Text variant="display">Add saved works</Text>
    {error && <Text accessibilityRole="alert" style={{ color: Gallery.destructive }}>{error}</Text>}
    {!works.length && <Text themeColor="textSecondary">{loadError ? 'Saved artworks couldn’t load.' : !updatedAt ? 'Loading saved artworks…' : 'Save an artwork to add it here.'}</Text>}
    {works.map((work) => {
      const current = audio.current?.work.artworkId === work.artworkId;
      const queued = audio.queue.some((track) => track.work.artworkId === work.artworkId);
      return <View key={work.localId} style={{ flexDirection: 'row', gap: 12, alignItems: 'center', paddingVertical: 12, borderBottomWidth: 0.5, borderColor: Gallery.softBorder }}>
        <ArtworkThumbnail uri={work.cropPath ? captureFileUri(work.cropPath) : undefined} />
        <View style={{ flex: 1 }}><Text style={{ fontSize: 14, fontWeight: '600' }}>{work.title}</Text><Text variant="metadata" themeColor="textSecondary">{work.artist}</Text>{!work.artworkId && <Text variant="metadata" themeColor="textSecondary">Identify this work to listen.</Text>}</View>
        <GalleryButton label={current ? 'Current' : queued ? 'Queued' : 'Add'} disabled={current || queued || !!pending || !work.artworkId} busy={pending === work.localId} busyLabel="Loading narration…" onPress={() => void add(work)} />
      </View>;
    })}
  </ScrollView>;
}
