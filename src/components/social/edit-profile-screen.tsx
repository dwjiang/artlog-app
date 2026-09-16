import { Column, Host, TextInput } from '@expo/ui';
import { accessibilityLabel } from '@expo/ui/swift-ui/modifiers';
import { useAction } from 'convex/react';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { api } from '../../../convex/_generated/api';
import { GalleryButton } from '../collection/gallery-button';
import { Gallery } from '@/constants/theme';
import { captureOwner } from '@/lib/account/owner-store';
import { chooseProfilePhoto, profilePhotoBytes, removeProfilePhotoDraft } from '@/lib/social/profile-photo';
import { useSocialSession } from '@/lib/social/use-social-session';
import { useSocialQuery } from '@/lib/social/use-social-query';
import type { PublicProfile } from '@/lib/social/types';
import { LIMITS } from '@/shared/journal/limits';
import { socialErrorMessage } from '@/shared/social/errors';
import { ProfileAvatar } from './profile-avatar';
import { SocialGate, SocialState } from './social-state';
import { visitStyles as styles } from '../visits/visit-ui';

export function EditProfileScreen() {
  const session = useSocialSession();
  const profile = useSocialQuery(api.profiles.mine, session.status === 'ready' ? {} : 'skip', session.key);
  if (session.status !== 'ready') return <SocialGate session={session} />;
  if (!profile.data) return <SocialState title={profile.error ? 'Couldn’t load your profile.' : 'Opening your profile…'}
    loading={!profile.error} action={profile.error ? 'Try again' : undefined} onAction={profile.refresh} />;
  return <EditProfileForm key={session.key} profile={profile.data} />;
}

export function EditProfileForm({ profile }: { profile: PublicProfile }) {
  const save = useAction(api.profilePhotos.save);
  const [name, setName] = useState(profile.name), [bio, setBio] = useState(profile.bio ?? '');
  const [photo, setPhoto] = useState<string | null>(), [busy, setBusy] = useState(false), [error, setError] = useState<string>();
  const draftFile = useRef<string>(undefined), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; removeProfilePhotoDraft(draftFile.current); }; }, []);
  async function choose() {
    setBusy(true); setError(undefined);
    try {
      const next = await chooseProfilePhoto();
      if (!mounted.current) { removeProfilePhotoDraft(next); return; }
      if (next) { removeProfilePhotoDraft(draftFile.current); draftFile.current = next; setPhoto(next); }
    } catch { if (mounted.current) setError('This photo could not be opened. Try another image.'); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function submit() {
    if (busy || !name.trim()) return;
    const owner = captureOwner(); setBusy(true); setError(undefined);
    try {
      const bytes = typeof photo === 'string' ? await profilePhotoBytes(photo) : photo;
      if (!owner.isCurrent() || !mounted.current) return;
      await save({ name: name.trim(), bio: bio.trim(), ...(bytes !== undefined ? { photo: bytes } : {}) });
      if (owner.isCurrent() && mounted.current) router.back();
    } catch (cause) { if (owner.isCurrent() && mounted.current) setError(socialErrorMessage(cause) ?? 'Your profile was not saved. Please try again.'); }
    finally { if (owner.isCurrent() && mounted.current) setBusy(false); }
  }
  const shownPhoto = photo === undefined ? profile.photoUrl : photo ?? undefined;
  return <ScrollView style={styles.page} contentInsetAdjustmentBehavior="automatic" automaticallyAdjustKeyboardInsets
    keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, { gap: 20 }]}>
    <View style={{ flexDirection: 'row', gap: 17, alignItems: 'center', paddingVertical: 14, borderBottomWidth: 0.5, borderColor: Gallery.separator }}>
      <ProfileAvatar name={name} photoUrl={shownPhoto} size={76} />
      <View><GalleryButton label={shownPhoto ? 'Change photo' : 'Add photo'} onPress={() => { void choose(); }} disabled={busy} />
        {shownPhoto && <GalleryButton label="Remove photo" onPress={() => { removeProfilePhotoDraft(draftFile.current); draftFile.current = undefined; setPhoto(null); }} disabled={busy} />}</View>
    </View>
    <Host matchContents={{ vertical: true }} colorScheme="light" seedColor={Gallery.accent}>
      <Column spacing={10} alignment="start">
        <TextInput defaultValue={name} placeholder="Name" onChangeText={setName} maxLength={LIMITS.name} autoCapitalize="words" editable={!busy}
          modifiers={[accessibilityLabel('Name')]} style={fieldStyle} textStyle={{ fontSize: 14, color: Gallery.ink }} />
        <TextInput defaultValue={bio} placeholder="A little about the art you love…" onChangeText={setBio} maxLength={LIMITS.bio} multiline numberOfLines={4} editable={!busy}
          modifiers={[accessibilityLabel('Introduction')]} style={fieldStyle} textStyle={{ fontSize: 14, color: Gallery.ink }} />
      </Column>
    </Host>
    <View style={{ gap: 8 }}><Text style={styles.caption}>Username</Text><Text selectable style={styles.input}>@{profile.username}</Text></View>
    <Text style={styles.fine}>Your photo, name and introduction appear on your public profile.</Text>
    {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    <GalleryButton label={busy ? 'Saving…' : 'Save profile'} onPress={() => { void submit(); }} disabled={busy || !name.trim()} variant="filled" fullWidth />
    <GalleryButton label="Cancel" onPress={() => router.back()} disabled={busy} fullWidth />
  </ScrollView>;
}
const fieldStyle = { padding: 12, backgroundColor: Gallery.surface, borderRadius: 9, borderWidth: 0.5, borderColor: Gallery.separator };
