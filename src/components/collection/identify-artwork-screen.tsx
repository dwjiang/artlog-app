import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';
import { api } from '../../../convex/_generated/api';
import { Gallery } from '@/constants/theme';
import { applyAlbum } from '@/db/repos/artwork-album';
import { editSavedWork, listSavedWorks, selectSavedWork, upsertFromRemote } from '@/db/repos/saved-works';
import type { SavedWork } from '@/db/schema';
import { captureOwner, useLocalOwner } from '@/lib/account/owner-store';
import { flushCollectionMedia } from '@/lib/account/collection-sync';
import { convex } from '@/lib/convex-client';
import { GalleryButton } from './gallery-button';

export function IdentifyArtworkScreen() {
  const { savedId } = useLocalSearchParams<{ savedId: string }>();
  const owner = useLocalOwner();
  const { data } = useLiveQuery(selectSavedWork(savedId, owner), [savedId, owner]);
  const work = data.find((row) => row.owner === owner && row.deletedAt === null);
  return work ? <Editor key={`${owner}:${savedId}`} work={work} /> : null;
}
function Editor({ work }: { work: SavedWork }) {
  const [title, setTitle] = useState(work.title === 'Unidentified artwork' ? '' : work.title), [artist, setArtist] = useState(work.artist);
  const [date, setDate] = useState(work.date ?? ''), [medium, setMedium] = useState(work.medium ?? '');
  const [search, setSearch] = useState(''), [choosing, setChoosing] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState<string>();
  const works = useLiveQuery(listSavedWorks(work.owner), [work.owner]);
  async function merge(target: SavedWork) {
    const session = captureOwner(); if (!session.scope) { setError('Connect to the internet to merge artworks.'); return; }
    setBusy(true); setError(undefined);
    try {
      await flushCollectionMedia({ saveLocalIds: [work.localId, target.localId] }); if (!session.isCurrent()) return;
      const result = await convex.mutation(api.artworkAlbums.merge, { scope: session.scope, sourceLocalId: work.localId, targetLocalId: target.localId });
      if (!session.isCurrent()) return;
      await upsertFromRemote(result.saves, session.owner); applyAlbum(result.photos, result.encounters, session.owner);
      router.replace({ pathname: '/[savedId]', params: { savedId: target.localId } });
    } catch { setError('Could not merge these artworks. Check your connection. Albums over 100 photos or very long combined notes need editing first.'); }
    finally { setBusy(false); }
  }
  return <ScrollView style={{ flex: 1, backgroundColor: Gallery.paper }} contentInsetAdjustmentBehavior="automatic" automaticallyAdjustKeyboardInsets contentContainerStyle={{ padding: 20, gap: 18 }}>
    <Text style={{ fontFamily: 'Georgia', fontSize: 26, color: Gallery.ink }}>Give this artwork a name.</Text>
    <Text style={{ color: Gallery.muted, fontSize: 13, lineHeight: 20 }}>Your photos and visits stay together as you learn more.</Text>
    {([{ label: 'Title', value: title, change: setTitle }, { label: 'Artist', value: artist, change: setArtist }, { label: 'Date', value: date, change: setDate }, { label: 'Medium', value: medium, change: setMedium }]).map((field) => <View key={field.label} style={{ gap: 6 }}><Text style={{ color: Gallery.muted, fontSize: 11 }}>{field.label}</Text><TextInput accessibilityLabel={field.label} value={field.value} onChangeText={field.change} maxLength={500} editable={!busy} style={{ backgroundColor: Gallery.fill, color: Gallery.ink, padding: 15, borderRadius: 10 }} /></View>)}
    <GalleryButton label="Save artwork details" variant="filled" fullWidth disabled={busy} onPress={() => { editSavedWork(work.localId, { title: title.trim() || 'Unidentified artwork', artist: artist.trim(), date: date.trim() || null, medium: medium.trim() || null }, work.owner); router.back(); }} />
    <GalleryButton label="This is an artwork I already saved" disabled={busy} onPress={() => setChoosing(!choosing)} />
    {choosing && <View style={{ gap: 12 }}><TextInput accessibilityLabel="Find saved artwork" placeholder="Search your collection" value={search} onChangeText={setSearch} style={{ padding: 14, backgroundColor: Gallery.fill, color: Gallery.ink, borderRadius: 10 }} />
      {works.data.filter((target) => target.owner === work.owner && target.localId !== work.localId && `${target.title} ${target.artist}`.toLowerCase().includes(search.toLowerCase())).map((target) => <GalleryButton key={target.localId} label={`${target.title} · ${target.artist}`} disabled={busy} onPress={() => Alert.alert('Combine these artworks?', `Move all photos, visit links, and private notes into “${target.title}”. The duplicate artwork and its shared placements will be removed.`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Combine artworks', onPress: () => { void merge(target); } }])} />)}
    </View>}
    {error && <Text accessibilityRole="alert" style={{ color: Gallery.destructive }}>{error}</Text>}
  </ScrollView>;
}
