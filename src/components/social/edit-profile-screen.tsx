import { useAction } from "convex/react";
import { router, Stack } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ScrollView, View } from "react-native";

import { GalleryButton } from "@/components/collection/gallery-button";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery } from "@/constants/theme";
import { captureOwner } from "@/lib/account/owner-store";
import { reportError } from "@/lib/observability";
import { profilePictureArgs, shownPicture, useProfilePictureDraft } from "@/lib/social/profile-picture";
import type { PublicProfile } from "@/lib/social/types";
import { useSocialQuery } from "@/lib/social/use-social-query";
import { useSocialSession } from "@/lib/social/use-social-session";
import { isUsernameProblem, useUsernameCheck } from "@/lib/social/use-username-check";
import { showToast } from "@/lib/ui/toast";
import { LIMITS } from "@/shared/journal/limits";
import { socialErrorMessage } from "@/shared/social/errors";

import { api } from "../../../convex/_generated/api";
import { ProfileAvatar } from "./profile-avatar";
import { ProfileField, UsernameField } from "./profile-fields";
import { ProfilePicturePicker } from "./profile-picture-picker";
import { SocialGate, SocialState } from "./social-state";

export function EditProfileScreen() {
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
  return <EditProfileForm key={session.key} profile={profile.data} scope={session.key} />;
}

export function EditProfileForm({ profile, scope }: { profile: PublicProfile; scope: string }) {
  const save = useAction(api.profilePhotos.save);
  const [name, setName] = useState(profile.name);
  const [initialUsername] = useState(profile.username);
  const [username, setUsername] = useState(initialUsername);
  const [bio, setBio] = useState(profile.bio ?? "");
  const { picture, choose } = useProfilePictureDraft();
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const usernameChanged = username !== initialUsername;
  const check = useUsernameCheck(username, scope);
  const usernameBlocked = usernameChanged && (check === "empty" || isUsernameProblem(check));
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function submit() {
    if (busy || !name.trim() || usernameBlocked) return;
    const owner = captureOwner();
    setBusy(true);
    setError(undefined);
    try {
      const pictureArgs = await profilePictureArgs(picture);
      if (!owner.isCurrent() || !mounted.current) return;
      await save({
        name: name.trim(),
        bio: bio.trim(),
        // Sending an unchanged username would revert a rename made on another device since this form opened.
        ...(usernameChanged ? { username } : {}),
        ...pictureArgs,
      });
      if (owner.isCurrent() && mounted.current) {
        showToast("Profile updated. Your wall and visits are unchanged.");
        router.back();
      }
    } catch (cause) {
      reportError(cause, "profile.update");
      if (owner.isCurrent() && mounted.current) {
        setError(socialErrorMessage(cause) ?? "Your profile was not saved. Please try again.");
      }
    } finally {
      if (owner.isCurrent() && mounted.current) setBusy(false);
    }
  }
  const shown = shownPicture(profile, picture);
  return (
    <>
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button disabled={busy} tintColor={Gallery.accent} onPress={() => router.back()}>
          Cancel
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
      <ScrollView
        style={{ flex: 1, backgroundColor: Gallery.paper }}
        contentInsetAdjustmentBehavior="automatic"
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 20, gap: 20 }}
      >
        <View style={{ alignItems: "center", gap: 8 }}>
          <ProfileAvatar name={name} photoUrl={shown.photoUrl} avatar={shown.avatar} size={80} />
          <GalleryButton label="Change picture" disabled={busy} onPress={() => setPicking(true)} />
        </View>
        <ProfilePicturePicker
          visible={picking}
          name={name}
          shown={shown}
          onCancel={() => setPicking(false)}
          onSave={(next) => {
            choose(next);
            setPicking(false);
          }}
        />
        <ProfileField label="Name" value={name} onChangeText={setName} maxLength={LIMITS.name} editable={!busy} />
        <UsernameField
          value={username}
          onChangeText={setUsername}
          check={check}
          hint={usernameChanged ? undefined : "Friends and your profile QR code keep working if you change it."}
          editable={!busy}
        />
        <ProfileField label="Bio" value={bio} onChangeText={setBio} maxLength={LIMITS.bio} multiline editable={!busy} />
        <Text style={{ color: Gallery.muted, fontSize: 13, lineHeight: 18 }}>
          Your picture, name and bio appear on your public profile.
        </Text>
        {error && (
          <Text accessibilityRole="alert" style={{ color: Gallery.destructive }}>
            {error}
          </Text>
        )}
        <GalleryButton
          label={error ? "Retry save" : "Save changes"}
          variant="filled"
          fullWidth
          busy={busy}
          disabled={busy || !name.trim() || usernameBlocked}
          onPress={() => {
            void submit();
          }}
        />
      </ScrollView>
    </>
  );
}
