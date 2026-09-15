import { Host, RNHostView } from '@expo/ui';
import { Toggle } from '@expo/ui/swift-ui';
import { accessibilityLabel, buttonStyle, disabled, toggleStyle } from '@expo/ui/swift-ui/modifiers';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { createContext, use, useEffect, useState } from 'react';
import { Alert, FlatList, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { Gallery } from '@/constants/theme';
import { useOwnerGeneration } from '@/lib/account/owner-store';
import { formatVisitDate } from '@/lib/journal/history';
import { useVisits } from '@/lib/journal/use-visits';
import type { VisitSummary } from '@/lib/journal/visit-summaries';
import { useVisitSharing } from '@/lib/visits/use-visit-sharing';
import { LIMITS } from '@/shared/journal/limits';
import { DisplayMedia } from '../artwork/display-media';
import { GalleryButton } from '../collection/gallery-button';
import { SavedWorkImage } from '../collection/saved-work-image';
import { ProfileForm } from '../social/profile-form';
import { AccountSection } from '../settings/account-section';
import { VisitMessage, VisitPage, VisitSymbol, visitStyles as styles } from './visit-ui';

type Sharing = ReturnType<typeof useVisitSharing>;
const ShareContext = createContext<{ sharing: Sharing; visit: VisitSummary } | null>(null);
function useShareFlow() {
  const value = use(ShareContext);
  if (!value) throw new Error('Visit sharing requires a visit');
  return value;
}
export function VisitShareLayout() {
  const { visitId } = useLocalSearchParams<{ visitId: string }>();
  const { owner, visits, loading, error } = useVisits();
  const visit = visits.find((row) => row.localId === visitId);
  if (!visit) return <VisitPage><VisitMessage loading={loading} action="Done" onAction={() => router.dismiss()}>
    {loading ? 'Loading visit…' : error ? 'This visit could not load.' : 'This visit is unavailable for this account.'}
  </VisitMessage></VisitPage>;
  return <ShareProvider key={`${owner}:${visitId}`} visit={visit} />;
}
function ShareProvider({ visit }: { visit: VisitSummary }) {
  const sharing = useVisitSharing(visit.localId, visit.works.map((work) => work.localId));
  const generation = useOwnerGeneration();
  const { controller, token } = sharing;
  useEffect(() => { if (visit.owner.startsWith('account:') && token) void controller.load(); }, [controller, token, generation, visit.owner]);
  return <ShareContext value={{ sharing, visit }}>
    <Stack screenOptions={{ headerTintColor: Gallery.accent, headerStyle: { backgroundColor: Gallery.paper },
      contentStyle: { backgroundColor: Gallery.paper }, headerShadowVisible: false }}>
      <Stack.Screen name="index" options={{ title: 'Share visit', headerRight: () => <GalleryButton label="Done" onPress={() => router.dismiss()} /> }} />
      <Stack.Screen name="preview" options={{ title: 'Preview', headerBackTitle: 'Edit' }} />
      <Stack.Screen name="shared" options={{ title: 'Shared visit' }} />
    </Stack>
  </ShareContext>;
}
function ShareError({ sharing }: { sharing: Sharing }) {
  return sharing.error ? <Text selectable accessibilityRole="alert" style={styles.error}>{sharing.error}</Text> : null;
}
export function VisitShareScreen() {
  const { sharing, visit } = useShareFlow();
  const [creatingProfile, setCreatingProfile] = useState(false);
  const { width, fontScale } = useWindowDimensions();
  const columns = fontScale > 1.5 ? 2 : 3;
  const tileWidth = (width - 40 - (columns - 1) * 8) / columns;
  const { controller, draft } = sharing;
  if (!visit.owner.startsWith('account:')) return <VisitPage><Text style={styles.body}>Sign in to share visits with friends.</Text><AccountSection /></VisitPage>;
  if (sharing.profileRequired) return creatingProfile ? <ProfileForm introduction="Create a profile so friends can recognize you. You will review this visit before sharing it." onCreated={() => { setCreatingProfile(false); void controller.load(); }} />
    : <VisitPage><Text style={styles.body}>Create a profile to share visits with friends.</Text><GalleryButton label="Create profile" variant="filled" onPress={() => setCreatingProfile(true)} /></VisitPage>;
  if (!draft) return <VisitPage><VisitMessage loading={sharing.busy} action="Try again" onAction={() => { void controller.load(); }}>Preparing sharing…</VisitMessage><ShareError sharing={sharing} /></VisitPage>;
  const selected = new Set(draft.saveLocalIds);
  const active = sharing.acknowledged?.status === 'active';
  async function preview() {
    if (await controller.preview()) router.push({ pathname: '/visit-share/[visitId]/preview', params: { visitId: visit.localId } });
  }
  return <FlatList key={columns} numColumns={columns} columnWrapperStyle={{ gap: 8 }} data={visit.works} keyExtractor={(work) => work.localId} contentInsetAdjustmentBehavior="automatic"
    keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive" contentContainerStyle={styles.content}
    ListHeaderComponent={<View style={{ gap: 18 }}>
      <Text style={[styles.title, { letterSpacing: -0.8 }]}>Choose what travels.</Text>
      <Text style={styles.caption}>Your visit to {visit.venueName}{'\n'}{formatVisitDate(visit.visitedOn)} · friends only</Text>
      {sharing.success && <Text accessibilityRole="alert" style={styles.body}>{sharing.success === 'published' ? 'Visit shared with friends.' : 'Sharing stopped.'}</Text>}
      {active && <View style={styles.card}>
        <Text style={styles.body}>Shared with friends</Text>
        <GalleryButton label="View shared visit" disabled={sharing.busy} onPress={() => router.push({ pathname: '/visit-share/[visitId]/shared', params: { visitId: visit.localId } })} />
        <GalleryButton label="Stop sharing" destructive disabled={sharing.busy} onPress={() => Alert.alert('Stop sharing this visit?', 'Friends will no longer be able to see this visit.',
          [{ text: 'Cancel', style: 'cancel' }, { text: 'Stop sharing', style: 'destructive', onPress: () => { void controller.unshare(); } }])} />
      </View>}
      {sharing.acknowledged?.removed ? <Text style={styles.error}>This share is no longer available.</Text> : <>
        <View style={styles.sectionLabel}><Text style={styles.caption}>Choose artworks</Text>
          <Text style={styles.fine}>{selected.size}/{LIMITS.selectedSaves} selected</Text></View>
        <GalleryButton label="Deselect all" disabled={sharing.busy || !selected.size} onPress={() => controller.edit({ saveLocalIds: [] })} />
        {!visit.works.length && <Text style={styles.caption}>You can share a visit with no artworks.</Text>}
      </>}
      <ShareError sharing={sharing} />
      {sharing.conflict && <GalleryButton label="Refresh sharing status" disabled={sharing.busy} onPress={() => { void controller.load(); }} />}
    </View>}
    renderItem={({ item }) => <Host matchContents={{ vertical: true }} colorScheme="light" style={{ width: tileWidth }}>
      <Toggle isOn={selected.has(item.localId)} onIsOnChange={(value) => controller.edit({ saveLocalIds: value ? [...draft.saveLocalIds, item.localId] : draft.saveLocalIds.filter((id) => id !== item.localId) })}
        modifiers={[toggleStyle('button'), buttonStyle('plain'), accessibilityLabel(`Share ${item.title}`),
          disabled(sharing.busy || (!selected.has(item.localId) && selected.size >= LIMITS.selectedSaves))]}>
        <RNHostView matchContents>
          <View style={{ width: tileWidth, padding: 7, borderRadius: 8, borderWidth: 0.5, borderColor: selected.has(item.localId) ? '#687B58' : '#26232020', backgroundColor: selected.has(item.localId) ? '#E3E8D8' : '#EBEDE4' }}>
            <SavedWorkImage contain path={item.cropPath} title={item.title} style={{ width: '100%', height: 83, marginTop: 12 }} />
            <Text style={{ fontSize: 10, lineHeight: 14, color: Gallery.ink, paddingTop: 5 }} numberOfLines={fontScale > 1.5 ? 2 : 1}>{item.title}</Text>
            <View style={{ position: 'absolute', top: 6, right: 6 }}><VisitSymbol name={selected.has(item.localId) ? 'checkmark.circle.fill' : 'circle'} size={17} color="#4E6144" /></View>
          </View>
        </RNHostView>
      </Toggle>
    </Host>}
    ListFooterComponent={<View style={{ gap: 12 }}>
      <Text style={styles.caption}>A reflection for friends (optional)</Text>
      <TextInput accessibilityLabel="Shared reflection" placeholder="What stayed with you?" value={draft.reflection}
        multiline maxLength={LIMITS.sharedReflection} editable={!sharing.busy} style={[styles.input, styles.reflection]}
        onChangeText={(reflection) => controller.edit({ reflection })} />
      <Text style={styles.fine}>{draft.reflection.length}/{LIMITS.sharedReflection} characters</Text>
      <View style={{ flexDirection: 'row', gap: 7 }}><VisitSymbol name="lock" size={13} color="#78816D" /><Text style={[styles.fine, { flex: 1 }]}>Your private reflection and artwork notes are not copied here. Only this selection and the reflection above will be shared.</Text></View>
      <GalleryButton label={sharing.busy ? 'Preparing…' : sharing.conflict ? 'Refresh preview' : 'Preview shared visit'} variant="filled" fullWidth
        disabled={sharing.busy || sharing.acknowledged?.removed} onPress={() => { void preview(); }} />
    </View>} />;
}
export function VisitSharePreviewScreen() {
  const { sharing } = useShareFlow();
  const { width } = useWindowDimensions();
  const { preview, controller } = sharing;
  async function publish() {
    if (await controller.publish()) router.back();
  }
  if (!preview) return <VisitPage><ShareError sharing={sharing} /><VisitMessage action="Back to selection" onAction={() => router.back()}>Refresh the preview before sharing.</VisitMessage></VisitPage>;
  return <VisitPage>
    <Text style={styles.caption}>This is what your friends will see.</Text>
    <Text style={styles.heading}>{preview.author.name}</Text><Text style={styles.caption}>@{preview.author.username}</Text>
    <Text style={styles.title}>{preview.venue.name}</Text><Text style={styles.body}>{formatVisitDate(preview.visitedOn)}</Text>
    {!!preview.reflection && <Text selectable style={styles.body}>{preview.reflection}</Text>}
    {preview.artworks.map(({ saveLocalId, artwork }) => <View key={saveLocalId} style={styles.card}>
      <DisplayMedia media={artwork.media} label={artwork.title} width={Math.min(width - 76, 420)} token={sharing.token} />
      <Text style={styles.body}>{artwork.title}</Text><Text style={styles.caption}>{artwork.artist}</Text>
    </View>)}
    <ShareError sharing={sharing} />
    <GalleryButton label={sharing.busy ? 'Sharing…' : sharing.acknowledged?.status === 'active' ? 'Update shared visit' : 'Share with friends'} variant="filled" fullWidth
      disabled={sharing.busy || sharing.conflict} onPress={() => { void publish(); }} />
    <Text style={styles.caption}>Only your friends can see this visit. Your private journal stays private.</Text>
    <Stack.Screen options={{ title: `Preview · ${preview.artworks.length} ${preview.artworks.length === 1 ? 'artwork' : 'artworks'}` }} />
  </VisitPage>;
}
export function VisitSharedScreen() {
  const { sharing } = useShareFlow();
  const { controller, shared } = sharing;
  const { width } = useWindowDimensions();
  useEffect(() => { void controller.view(); }, [controller]);
  return <VisitPage>
    {shared ? <>
      <Text style={styles.heading}>{shared.author.name}</Text><Text style={styles.title}>{shared.venue.name}</Text>
      <Text style={styles.body}>{formatVisitDate(shared.visitedOn)}</Text>
      {!!shared.reflection && <Text selectable style={styles.body}>{shared.reflection}</Text>}
      {shared.artworks.page.map((item) => <View key={item.itemId} style={styles.card}>
        <DisplayMedia media={item.artwork.media} label={item.artwork.title} width={Math.min(width - 76, 420)} token={sharing.token} />
        <Text style={styles.body}>{item.artwork.title}</Text><Text style={styles.caption}>{item.artwork.artist}</Text>
      </View>)}
    </> : <VisitMessage loading={sharing.busy} action="Try again" onAction={() => { void controller.view(); }}>Loading shared visit…</VisitMessage>}
    <ShareError sharing={sharing} />
  </VisitPage>;
}
