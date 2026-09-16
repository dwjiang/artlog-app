import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useCollectionWall } from '@/lib/wall/use-collection-wall';
import { Gallery } from '@/constants/theme';
import { NoteVisibility } from '../collection/note-visibility';
import { GalleryButton } from '../collection/gallery-button';
import { SocialState } from './social-state';

export function PublicNotesScreen() {
  const wall = useCollectionWall([]);
  const [preview, setPreview] = useState(false), [saved, setSaved] = useState(false);
  const changes = wall.noteDraft;
  const items = wall.acknowledged?.items ?? [];
  function visible(item: typeof items[number]) { return changes.find((change) => change.itemId === item.itemId)?.visible ?? item.noteVisible; }
  function toggle(item: typeof items[number], value: boolean) {
    wall.repository.setNoteDraft([...changes.filter((change) => change.itemId !== item.itemId), { itemId: item.itemId, visible: value }]);
    setSaved(false); wall.setError(undefined);
  }
  async function save() {
    wall.setError(undefined);
    try { await wall.repository.publishNotes(); setSaved(true); setPreview(false); }
    catch { wall.setError(wall.repository.getSnapshot().needsNoteConfirmation ? 'A note changed. Review the latest notes and choose again.' : 'Your choices were not saved. Check your connection and try again.'); }
  }
  return <ScrollView style={{ flex: 1, backgroundColor: Gallery.paper }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, gap: 24 }}>
    <Text style={{ fontSize: 14, lineHeight: 21, color: Gallery.muted }}>Your thoughts belong to you. Choose which notes visitors can read alongside artworks on your wall.</Text>
    {!wall.signedIn ? <SocialState title="Sign in to share notes." detail="Your collection notes stay private on this device." />
      : wall.profileRequired ? <SocialState title="Create your public profile first." /> : wall.loading ? <SocialState title="Opening your notes…" loading /> : <>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><GalleryButton label={preview ? 'Back to selection' : 'Preview'} onPress={() => setPreview(!preview)} />
          <GalleryButton label={wall.pending ? 'Saving…' : 'Save choices'} disabled={wall.pending || !changes.length} variant="filled" onPress={() => { void save(); }} /></View>
        {items.filter((item) => preview ? visible(item) : item.noteEligible || item.noteVisible).map((item) => <View key={item.itemId} style={{ paddingBottom: 22, gap: 12, borderBottomWidth: 0.5, borderBottomColor: Gallery.separator }}>
          <Text style={{ fontSize: 14, fontWeight: '600', color: Gallery.ink }}>{item.artwork.artist}</Text>
          <Text style={{ fontSize: 13, fontStyle: 'italic', color: Gallery.muted }}>{item.artwork.title}</Text>
          {!!item.privateNote && <Text selectable style={{ fontFamily: 'Georgia', fontSize: 17, lineHeight: 24, color: Gallery.ink }}>{item.privateNote}</Text>}
          {!preview && <NoteVisibility visible={visible(item)} disabled={wall.pending || (!item.noteEligible && !item.noteVisible)} onChange={(value) => toggle(item, value)} />}
        </View>)}
        {!items.some((item) => preview ? visible(item) : item.noteEligible) && <Text style={{ color: Gallery.muted, lineHeight: 21 }}>{preview ? 'No notes will be shown to visitors.' : 'Add a note to an artwork on your wall. It will appear here after syncing.'}</Text>}
        {saved && <Text accessibilityRole="alert" style={{ color: Gallery.accent }}>Your choices are saved.</Text>}
      </>}
    {wall.error && <View style={{ gap: 8 }}><Text accessibilityRole="alert" style={{ color: Gallery.destructive }}>{wall.error}</Text><GalleryButton label="Refresh notes" onPress={() => { void wall.refresh(); }} /></View>}
  </ScrollView>;
}
