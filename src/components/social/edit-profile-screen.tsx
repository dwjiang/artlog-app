import { ScrollView, TextInput, View } from 'react-native';
import { GalleryButton } from '../collection/gallery-button';
import { ThemedText as Text } from '../themed-text';
import { useAction } from 'convex/react';
import { router, Stack } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../../convex/_generated/api';
import { Gallery } from '@/constants/theme';
import { captureOwner } from '@/lib/account/owner-store';
import { chooseProfilePhoto, profilePhotoBytes, removeProfilePhotoDraft } from '@/lib/social/profile-photo';
import { useSocialSession } from '@/lib/social/use-social-session';
import { useSocialQuery } from '@/lib/social/use-social-query';
import { showToast } from '@/lib/ui/toast';

import type { PublicProfile } from '@/lib/social/types';
import { LIMITS } from '@/shared/journal/limits';
import { socialErrorMessage } from '@/shared/social/errors';
import { ProfileAvatar } from './profile-avatar';
import { SocialGate, SocialState } from './social-state';

export function EditProfileScreen() {
  const session = useSocialSession();
  const profile = useSocialQuery(api.profiles.mine, session.status === 'ready' ? {} : 'skip', session.key);
  if (session.status !== 'ready') return <SocialGate session={session} />;
  if (profile.data === null) return <SocialState title="Profile unavailable." detail="Your profile is no longer available for this account." action="Back" onAction={() => router.back()} />;
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
      if (owner.isCurrent() && mounted.current) { showToast('Profile updated. Your wall and visits are unchanged.'); router.back(); }
    } catch (cause) { if (owner.isCurrent() && mounted.current) setError(socialErrorMessage(cause) ?? 'Your profile was not saved. Please try again.'); }
    finally { if (owner.isCurrent() && mounted.current) setBusy(false); }
  }
  const shownPhoto = photo === undefined ? profile.photoUrl : photo ?? undefined;
  return <>
    <Stack.Toolbar placement="left">
      <Stack.Toolbar.Button disabled={busy} tintColor={Gallery.accent} onPress={() => router.back()}>Cancel</Stack.Toolbar.Button>
    </Stack.Toolbar>
    <ScrollView style={{ flex: 1, backgroundColor: Gallery.paper }} contentInsetAdjustmentBehavior="automatic" automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 20 }}>
      <View style={{ alignItems: 'center', gap: 8 }}><ProfileAvatar name={name} photoUrl={shownPhoto} size={80} />
        <GalleryButton label={shownPhoto ? 'Change photo' : 'Add photo'} disabled={busy} onPress={() => { void choose(); }} />
        {shownPhoto && <GalleryButton label="Remove photo" destructive disabled={busy} onPress={() => { removeProfilePhotoDraft(draftFile.current); draftFile.current = undefined; setPhoto(null); }} />}
      </View>
      {([{ label: 'Name', value: name, change: setName, max: LIMITS.name }, { label: 'Introduction', value: bio, change: setBio, max: LIMITS.bio }]).map((field) => <View key={field.label} style={{ gap: 8 }}>
        <Text>{field.label}</Text><TextInput accessibilityLabel={field.label} value={field.value} onChangeText={field.change} maxLength={field.max} multiline={field.label === 'Introduction'} editable={!busy} keyboardAppearance="light" selectionColor={Gallery.accent}
          style={{ minHeight: field.label === 'Introduction' ? 100 : 48, padding: 14, borderRadius: 8, borderWidth: 1, borderColor: Gallery.controlBorder, color: Gallery.ink, backgroundColor: Gallery.surface, fontSize: 17, textAlignVertical: 'top' }} />
      </View>)}
      <View style={{ gap: 4 }}><Text style={{ color: Gallery.muted }}>@{profile.username}</Text><Text style={{ color: Gallery.muted, fontSize: 13 }}>Usernames can’t be changed.</Text></View>
      <Text style={{ color: Gallery.muted, fontSize: 13, lineHeight: 18 }}>Your photo, name and introduction appear on your public profile.</Text>
      {error && <Text accessibilityRole="alert" style={{ color: Gallery.destructive }}>{error}</Text>}
      <GalleryButton label={error ? 'Retry save' : 'Save changes'} variant="filled" fullWidth busy={busy} disabled={!name.trim()} onPress={() => { void submit(); }} />
    </ScrollView>
  </>;
}
