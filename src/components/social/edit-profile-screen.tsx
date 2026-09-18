import { ListItem, TextInput } from '@expo/ui';
import { LabeledContent } from '@expo/ui/swift-ui';
import { accessibilityLabel, disabled } from '@expo/ui/swift-ui/modifiers';
import { useAction } from 'convex/react';
import { router, Stack } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../../convex/_generated/api';
import { ActionRow, GroupedFooter, GroupedList, GroupedSection, ValueRow } from '@/components/grouped-list';
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
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Button variant="done" disabled={busy || !name.trim()} tintColor={Gallery.accent} onPress={() => { void submit(); }}>{busy ? 'Saving…' : 'Save'}</Stack.Toolbar.Button>
    </Stack.Toolbar>
    <GroupedList>
      <GroupedSection>
        <ListItem leading={<ProfileAvatar name={name} photoUrl={shownPhoto} size={56} />} modifiers={[disabled(busy)]} onPress={() => { void choose(); }}>{shownPhoto ? 'Change photo' : 'Add photo'}</ListItem>
        {shownPhoto ? <ActionRow label="Remove photo" destructive disabled={busy}
          onPress={() => { removeProfilePhotoDraft(draftFile.current); draftFile.current = undefined; setPhoto(null); }} /> : null}
      </GroupedSection>
      <GroupedSection footer={<GroupedFooter tone={error ? 'destructive' : 'muted'}>{error ?? 'Your photo, name and introduction appear on your public profile.'}</GroupedFooter>}>
        <LabeledContent label="Name"><TextInput defaultValue={name} placeholder="Name" onChangeText={setName} maxLength={LIMITS.name} autoCapitalize="words" editable={!busy}
          modifiers={[accessibilityLabel('Name')]} /></LabeledContent>
        <LabeledContent label="Introduction"><TextInput defaultValue={bio} placeholder="A little about the art you love…" onChangeText={setBio} maxLength={LIMITS.bio} multiline numberOfLines={4} editable={!busy}
          modifiers={[accessibilityLabel('Introduction')]} /></LabeledContent>
      </GroupedSection>
      <GroupedSection footer={<GroupedFooter>Usernames can’t be changed.</GroupedFooter>}>
        <ValueRow label="Username" value={`@${profile.username}`} />
      </GroupedSection>
    </GroupedList>
  </>;
}
