import { useAction } from "convex/react";
import { router } from "expo-router";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { SafeAreaScrollView } from "@/components/safe-area-scroll";
import { CancelToolbar, CommitToolbar } from "@/components/sheet-controls";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery } from "@/constants/theme";
import { useDiscardEditsGuard } from "@/hooks/use-discard-edits-guard";
import { setLocalProfileName, setLocalProfilePicture, useLocalProfile } from "@/lib/account/local-profile";
import { captureOwner, useLocalOwner } from "@/lib/account/owner-store";
import { reportError } from "@/lib/observability";
import { profilePictureArgs, shownPicture, useProfilePictureDraft } from "@/lib/social/profile-picture";
import { useSafetyChecks } from "@/lib/social/safety-checks";
import type { PublicProfile } from "@/lib/social/types";
import { useSocialQuery } from "@/lib/social/use-social-query";
import { useSocialSession } from "@/lib/social/use-social-session";
import { isUsernameProblem, useUsernameCheck } from "@/lib/social/use-username-check";
import { showToast } from "@/lib/ui/toast";
import { LIMITS } from "@/shared/journal/limits";
import { socialErrorMessage } from "@/shared/social/errors";

import { api } from "../../../convex/_generated/api";
import { BioField, ProfileField, UsernameField } from "./profile-fields";
import { ProfilePictureField } from "./profile-picture-field";
import { SocialGate, SocialState } from "./social-state";

export function EditProfileScreen() {
  const guest = !useLocalOwner().startsWith("account:");
  return guest ? <GuestProfileForm /> : <AccountProfileScreen />;
}

function AccountProfileScreen() {
  const session = useSocialSession();
  const profile = useSocialQuery(api.profiles.mine, session.status === "ready" ? {} : "skip", session.key);
  if (session.status !== "ready") return <SocialGate session={session} />;
  if (profile.data === null) {
    return (
      <SocialState
        title="Profile unavailable."
        detail="Your profile is no longer available for this account."
        action="Back"
        onAction={() => router.back()}
      />
    );
  }
  if (!profile.data) {
    return (
      <SocialState
        title={profile.error ? "Couldn’t load your profile." : "Opening your profile…"}
        loading={!profile.error}
        action={profile.error ? "Try again" : undefined}
        onAction={profile.refresh}
      />
    );
  }
  return (
    <EditProfileForm key={session.key} profile={profile.data} scope={session.key} safetyChecks={session.safetyChecks} />
  );
}

export function EditProfileForm({
  profile,
  scope,
  safetyChecks,
}: {
  profile: PublicProfile;
  scope: string;
  safetyChecks: boolean;
}) {
  const save = useAction(api.profilePhotos.save);
  const [initial] = useState({ name: profile.name, username: profile.username, bio: profile.bio ?? "" });
  const [name, setName] = useState(initial.name);
  const [username, setUsername] = useState(initial.username);
  const [bio, setBio] = useState(initial.bio);
  const checks = useSafetyChecks({ safetyChecks });
  const { picture, choose } = useProfilePictureDraft();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const usernameChanged = username !== initial.username;
  const leave = useDiscardEditsGuard({
    edited: name !== initial.name || usernameChanged || bio !== initial.bio || !!picture,
    busy,
  });
  const check = useUsernameCheck(username, scope);
  const usernameBlocked = usernameChanged && (check === "empty" || isUsernameProblem(check));
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const submit = async () => {
    if (busy || !name.trim() || usernameBlocked) return;
    const owner = captureOwner();
    setBusy(true);
    setError(undefined);
    try {
      const pictureArgs = await profilePictureArgs(picture);
      if (!owner.isOwnerCurrent() || !mounted.current) return;
      await save({
        name: name.trim(),
        // Without safety checks the bio can't change, so it's left out and stays as it is.
        ...(checks.enabled ? { bio: bio.trim() } : {}),
        // Sending an unchanged username would revert a rename made on another device since this form opened.
        ...(usernameChanged ? { username } : {}),
        ...pictureArgs,
      });
      if (owner.isOwnerCurrent() && mounted.current) {
        showToast("Profile updated. Your wall and visits are unchanged.");
        leave();
      }
    } catch (cause) {
      reportError(cause, "profile.update");
      if (owner.isOwnerCurrent() && mounted.current) {
        setError(socialErrorMessage(cause) ?? "Your profile was not saved. Please try again.");
      }
    } finally {
      if (owner.isOwnerCurrent() && mounted.current) setBusy(false);
    }
  };
  const shown = shownPicture(profile, picture);
  return (
    <ProfileFormSheet
      busy={busy}
      error={error}
      canSave={!!name.trim() && !usernameBlocked}
      onSave={() => void submit()}
    >
      <ProfilePictureField name={name} shown={shown} disabled={busy} onChoose={choose} />
      <ProfileField label="Name" value={name} onChangeText={setName} maxLength={LIMITS.name} editable={!busy} />
      <UsernameField
        value={username}
        onChangeText={setUsername}
        check={check}
        hint={usernameChanged ? undefined : "Friends and your profile QR code keep working if you change it."}
        editable={!busy}
      />
      <BioField label="Bio" value={bio} onChangeText={setBio} editable={!busy} checks={checks} />
      <Text style={{ color: Gallery.muted, fontSize: 13, lineHeight: 18 }}>
        Your picture, name and bio appear on your public profile.
      </Text>
    </ProfileFormSheet>
  );
}

/** A guest's name and picture, kept on this iPhone; a blank name shows them as Guest. */
function GuestProfileForm() {
  const localProfile = useLocalProfile();
  const [draft, setDraft] = useState<string>();
  const name = draft ?? localProfile.name ?? "";
  const { picture, choose, commit } = useProfilePictureDraft();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const leave = useDiscardEditsGuard({ edited: name !== (localProfile.name ?? "") || !!picture, busy });
  const submit = async () => {
    if (busy || localProfile.loading) return;
    setBusy(true);
    setError(undefined);
    let saving = "name";
    try {
      await setLocalProfileName(name);
      saving = "picture";
      await setLocalProfilePicture(picture);
      commit();
      leave();
    } catch (cause) {
      reportError(cause, "account.local_profile.save");
      setError(`Your ${saving} couldn’t be saved. Please try again.`);
      setBusy(false);
    }
  };
  const shown = shownPicture(localProfile, picture);
  return (
    <ProfileFormSheet busy={busy} error={error} canSave={!localProfile.loading} onSave={() => void submit()}>
      <ProfilePictureField
        name={name.trim() || undefined}
        shown={shown}
        disabled={busy || localProfile.loading}
        onChoose={choose}
      />
      <ProfileField
        label="Name"
        value={name}
        onChangeText={setDraft}
        placeholder="Name or nickname"
        maxLength={LIMITS.name}
        textContentType="nickname"
        autoCapitalize="words"
        returnKeyType="done"
        editable={!busy && !localProfile.loading}
        onSubmitEditing={() => void submit()}
      />
    </ProfileFormSheet>
  );
}

/** Edit profile's sheet: Cancel and Save in the bar, then the fields and any save error. */
function ProfileFormSheet({
  busy,
  error,
  canSave,
  onSave,
  children,
}: {
  busy: boolean;
  error?: string;
  canSave: boolean;
  onSave: () => void;
  children: ReactNode;
}) {
  return (
    <>
      <CancelToolbar disabled={busy} onPress={() => router.back()} />
      <CommitToolbar label="Save" busyLabel="Saving profile…" busy={busy} disabled={!canSave} onPress={onSave} />
      <SafeAreaScrollView
        style={{ flex: 1, backgroundColor: Gallery.paper }}
        contentInsetAdjustmentBehavior="automatic"
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 20, gap: 20 }}
      >
        {children}
        {error && (
          <Text accessibilityRole="alert" style={{ color: Gallery.destructive }}>
            {error}
          </Text>
        )}
      </SafeAreaScrollView>
    </>
  );
}
