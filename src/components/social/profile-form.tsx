import { useAction } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { ScrollView, View } from "react-native";

import { ActionStack } from "@/components/action-stack";
import { GalleryButton } from "@/components/collection/gallery-button";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery } from "@/constants/theme";
import { useLocalProfile } from "@/lib/account/local-profile";
import { captureOwner } from "@/lib/account/owner-store";
import { reportError } from "@/lib/observability";
import { profilePhotoBytes } from "@/lib/social/profile-photo";
import { shownPicture, useProfilePictureDraft } from "@/lib/social/profile-picture";
import { useSafetyChecks } from "@/lib/social/safety-checks";
import { useSocialSession } from "@/lib/social/use-social-session";
import { isUsernameProblem, useUsernameCheck } from "@/lib/social/use-username-check";
import { LIMITS } from "@/shared/journal/limits";
import { socialErrorMessage } from "@/shared/social/errors";

import { api } from "../../../convex/_generated/api";
import { ProfileAvatar } from "./profile-avatar";
import { BioField, ProfileField, UsernameField } from "./profile-fields";
import { ProfilePicturePicker } from "./profile-picture-picker";

export function ProfileForm({ onCreated, introduction }: { onCreated: () => void; introduction: string }) {
  const create = useAction(api.profiles.create);
  const savePhoto = useAction(api.profilePhotos.save);
  const localProfile = useLocalProfile();
  const { picture, choose } = useProfilePictureDraft();
  const [picking, setPicking] = useState(false);
  const [profileCreated, setProfileCreated] = useState(false);
  const mounted = useRef(true);
  const created = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const session = useSocialSession();
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const checks = useSafetyChecks(session);
  const bioArgs = checks.enabled ? { bio: bio.trim() } : {};
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const submitting = useRef(false);
  const shown = shownPicture({ avatar: localProfile.avatar }, picture);
  const check = useUsernameCheck(username, session.key);
  const usernameBlocked = check === "empty" || isUsernameProblem(check);
  async function submit() {
    if (submitting.current || !name.trim() || (!created.current && usernameBlocked)) {
      return;
    }
    const owner = captureOwner();
    submitting.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const bytes = picture?.kind === "photo" ? await profilePhotoBytes(picture.uri) : undefined;
      if (!owner.isOwnerCurrent() || !mounted.current) return;
      if (!created.current) {
        await create({
          name: name.trim(),
          username,
          ...bioArgs,
          avatar: shown.avatar,
        });
        created.current = true;
        setProfileCreated(true);
      }
      if (!owner.isOwnerCurrent() || !mounted.current) return;
      if (bytes) {
        await savePhoto({ name: name.trim(), ...bioArgs, photo: bytes });
      }
      if (owner.isOwnerCurrent() && mounted.current) onCreated();
    } catch (cause) {
      reportError(cause, created.current ? "profile.photo.save" : "profile.create");
      if (owner.isOwnerCurrent() && mounted.current) {
        setError(
          created.current
            ? "Your profile is ready, but the photo could not upload. Retry or continue without it."
            : (socialErrorMessage(cause) ?? "Your profile could not be created. Your edits are kept. Try again."),
        );
      }
    } finally {
      submitting.current = false;
      if (owner.isOwnerCurrent() && mounted.current) setBusy(false);
    }
  }
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: Gallery.paper }}
      contentInsetAdjustmentBehavior="automatic"
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 20, gap: 20 }}
    >
      <View style={{ gap: 10 }}>
        <Text variant="pageTitle">Create a public profile.</Text>
        <Text style={{ color: Gallery.muted, fontSize: 15, lineHeight: 22 }}>{introduction}</Text>
      </View>
      <View style={{ alignItems: "center", gap: 8 }}>
        <ProfileAvatar name={name || "You"} photoUrl={shown.photoUrl} avatar={shown.avatar} size={72} />
        <GalleryButton label="Change picture" disabled={busy || profileCreated} onPress={() => setPicking(true)} />
      </View>
      <ProfilePicturePicker
        visible={picking}
        name={name || "You"}
        shown={shown}
        onCancel={() => setPicking(false)}
        onSave={(next) => {
          choose(next);
          setPicking(false);
        }}
      />
      <ProfileField
        label="Name"
        value={name}
        onChangeText={setName}
        maxLength={LIMITS.name}
        editable={!busy && !profileCreated}
      />
      <UsernameField
        value={username}
        onChangeText={setUsername}
        check={check}
        hint={profileCreated ? "Username saved" : undefined}
        editable={!busy && !profileCreated}
      />
      <BioField
        label="Bio (optional)"
        value={bio}
        onChangeText={setBio}
        editable={!busy && !profileCreated}
        checks={checks}
      />
      <Text style={{ fontSize: 13, lineHeight: 18, color: Gallery.muted }}>
        Your name, picture and bio appear on your public profile. Visits and private notes are separate.
      </Text>
      {error && (
        <Text accessibilityRole="alert" style={{ color: Gallery.destructive }}>
          {error}
        </Text>
      )}
      <ActionStack
        textActions={
          profileCreated
          && error && <GalleryButton label="Continue without photo" fullWidth disabled={busy} onPress={onCreated} />
        }
      >
        <GalleryButton
          label={error ? "Try again" : "Create public profile"}
          variant="filled"
          fullWidth
          busy={busy}
          disabled={!name.trim() || (!profileCreated && usernameBlocked)}
          onPress={() => {
            void submit();
          }}
        />
      </ActionStack>
    </ScrollView>
  );
}
