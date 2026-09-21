import { EmptyState } from '../empty-state';
import { EmptyPaper } from '../empty-state-art';
import { GalleryButton } from '../collection/gallery-button';
import { Switch, Text } from '@expo/ui';
import { Text as SwiftText } from '@expo/ui/swift-ui';
import { font, foregroundStyle, italic } from '@expo/ui/swift-ui/modifiers';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { ScrollView } from 'react-native';
import { ActionRow, GroupedFooter, GroupedList, GroupedSection } from '@/components/grouped-list';
import { Gallery } from '@/constants/theme';
import { signInRoute } from '@/lib/account/sign-in-context';
import { showToast } from '@/lib/ui/toast';
import { useCollectionWall } from '@/lib/wall/use-collection-wall';
import { PublicNotesPreview } from './public-notes-preview';
import { SocialState } from './social-state';
import { socialStyles } from './social-styles';

const INTRO = 'Choose which notes visitors can read alongside artworks on your wall. Editing a shared note makes it private until you share it again.';

export function PublicNotesScreen() {
  const wall = useCollectionWall([]);
  const [preview, setPreview] = useState(false);
  const changes = wall.noteDraft;
  const items = wall.acknowledged?.items ?? [];
  function visible(item: typeof items[number]) { return changes.find((change) => change.itemId === item.itemId)?.visible ?? item.noteVisible; }
  function toggle(item: typeof items[number], value: boolean) {
    wall.repository.setNoteDraft([...changes.filter((change) => change.itemId !== item.itemId), { itemId: item.itemId, visible: value }]);
    wall.setError(undefined);
  }
  async function save() {
    wall.setError(undefined);
    try { await wall.repository.publishNotes(); setPreview(false); showToast('Your note choices are saved.'); }
    catch { wall.setError(wall.repository.getSnapshot().needsNoteConfirmation ? 'A note changed. Review the latest notes and choose again.' : 'Your choices were not saved. Check your connection and try again.'); }
  }
  const gate = !wall.signedIn ? <SocialState title="Sign in to share notes." icon="note.text" action="Sign in" onAction={() => router.push(signInRoute('wall'))} />
    : wall.profileRequired ? <SocialState title="Create your public profile first." icon="person.crop.circle.badge.plus" action="Create your profile" onAction={() => router.push('/create-profile')} />
      : wall.loading || (!wall.acknowledged && !wall.error) ? <SocialState title="Opening your notes…" loading /> : null;
  if (gate) return <ScrollView style={socialStyles.root} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={socialStyles.gate}>{gate}</ScrollView>;
  // The header keeps only direct Toolbar.Button children, so no fragments here.
  const toolbar = <Stack.Toolbar placement="right">
    {preview ? <Stack.Toolbar.Button tintColor={Gallery.ink} onPress={() => setPreview(false)}>Edit</Stack.Toolbar.Button>
      : <Stack.Toolbar.Button tintColor={Gallery.ink} onPress={() => setPreview(true)}>Preview</Stack.Toolbar.Button>}
    {!preview && <Stack.Toolbar.Button variant="done" tintColor={Gallery.ink} disabled={wall.pending || !changes.length} onPress={() => { void save(); }}>{wall.pending ? 'Saving…' : 'Save'}</Stack.Toolbar.Button>}
  </Stack.Toolbar>;
  if (preview && wall.acknowledged) return <>{toolbar}
    <ScrollView style={socialStyles.root} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingVertical: 20 }}>
      <PublicNotesPreview wall={{ profileId: wall.acknowledged.profileId, color: wall.acknowledged.color,
        artworkCount: new Set(items.map((item) => item.saveLocalId)).size, items: items.map((item) => ({ itemId: item.itemId, layout: item.layout, artwork: item.artwork,
          ...(visible(item) && item.privateNote ? { note: item.privateNote } : {}) })) }} />
    </ScrollView>
  </>;
  const eligible = items.filter((item) => item.noteEligible || item.noteVisible);
  if (!eligible.length && !wall.error) return <ScrollView style={socialStyles.root} contentInsetAdjustmentBehavior="automatic">
    <EmptyState title="No notes to share yet." detail="Add a private note to an artwork on your wall. After it syncs, you can choose whether to show it here."
      visual={<EmptyPaper kind="note" />} footnote="Notes stay private unless you choose to share them.">
      <GalleryButton label="Go to your wall" variant="filled" fullWidth onPress={() => { router.dismissAll(); router.navigate({ pathname: '/collection', params: { view: 'wall' } }); }} />
    </EmptyState>
  </ScrollView>;
  return <>{toolbar}
    <GroupedList>
      <GroupedSection footer={wall.error ? <GroupedFooter tone="destructive">{wall.error}</GroupedFooter> : undefined}>
        <Text textStyle={{ color: Gallery.ink }} modifiers={[font({ textStyle: 'subheadline' })]}>{INTRO}</Text>
        {wall.error ? <ActionRow label="Refresh notes" icon="arrow.clockwise" onPress={() => { void wall.refresh(); }} /> : null}
      </GroupedSection>
      {eligible.map((item) => <GroupedSection key={item.itemId}>
        <SwiftText modifiers={[font({ textStyle: 'subheadline', weight: 'semibold' }), foregroundStyle(Gallery.ink)]}>{item.artwork.artist}</SwiftText>
        <SwiftText modifiers={[font({ textStyle: 'footnote' }), italic(), foregroundStyle(Gallery.muted)]}>{item.artwork.title}</SwiftText>
        {item.privateNote ? <SwiftText modifiers={[font({ textStyle: 'body' }), foregroundStyle(Gallery.ink)]}>{item.privateNote}</SwiftText> : null}
        <Switch label="Show note on public wall" value={visible(item)} disabled={wall.pending || (!item.noteEligible && !item.noteVisible)} onValueChange={(value) => toggle(item, value)} />
      </GroupedSection>)}
    </GroupedList>
  </>;
}
