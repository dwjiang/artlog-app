import { useAction, useMutation } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { ScrollView, View } from "react-native";

import { GalleryButton } from "@/components/collection/gallery-button";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery } from "@/constants/theme";
import { captureOwner } from "@/lib/account/owner-store";
import { reportError } from "@/lib/observability";
import { chooseProfilePhoto, profilePhotoBytes, removeProfilePhotoDraft } from "@/lib/social/profile-photo";
import { useSocialSession } from "@/lib/social/use-social-session";
import { isUsernameProblem, useUsernameCheck } from "@/lib/social/use-username-check";
import { LIMITS } from "@/shared/journal/limits";
import { socialErrorMessage } from "@/shared/social/errors";

import { api } from "../../../convex/_generated/api";
import { ProfileAvatar } from "./profile-avatar";
import { ProfileField, UsernameField } from "./profile-fields";

export function ProfileForm({ onCreated, introduction }: { onCreated: () => void; introduction: string }) {
  const create = useMutation(api.profiles.create);
  const savePhoto = useAction(api.profilePhotos.save);
  const [photo, setPhoto] = useState<string>();
  const [profileCreated, setProfileCreated] = useState(false);
  const photoDraft = useRef<string>(undefined);
  const mounted = useRef(true);
  const created = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      removeProfilePhotoDraft(photoDraft.current);
    };
  }, []);
  const session = useSocialSession();
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const submitting = useRef(false);
  const check = useUsernameCheck(username, session.key);
  const usernameBlocked = check === "empty" || isUsernameProblem(check);
  async function choose() {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const next = await chooseProfilePhoto();
      if (!mounted.current) {
        removeProfilePhotoDraft(next);
        return;
      }
      if (next) {
        removeProfilePhotoDraft(photoDraft.current);
        photoDraft.current = next;
        setPhoto(next);
      }
    } catch (cause) {
      reportError(cause, "profile.photo.choose");
      if (mounted.current) {
        setError("This photo could not be opened. Try another image.");
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function submit() {
    if (submitting.current || !name.trim() || (!created.current && usernameBlocked)) {
      return;
    }
    const owner = captureOwner();
    submitting.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const bytes = photo ? await profilePhotoBytes(photo) : undefined;
      if (!owner.isCurrent() || !mounted.current) return;
      if (!created.current) {
        await create({
          name: name.trim(),
          username,
          bio: bio.trim(),
        });
        created.current = true;
        setProfileCreated(true);
      }
      if (!owner.isCurrent() || !mounted.current) return;
      if (bytes) {
        await savePhoto({ name: name.trim(), bio: bio.trim(), photo: bytes });
      }
      if (owner.isCurrent() && mounted.current) onCreated();
    } catch (cause) {
      reportError(cause, created.current ? "profile.photo.save" : "profile.create");
      if (owner.isCurrent() && mounted.current) {
        setError(
          created.current
            ? "Your profile is ready, but the photo could not upload. Retry or continue without it."
            : (socialErrorMessage(cause) ?? "Your profile could not be created. Your edits are kept. Try again."),
        );
      }
    } finally {
      submitting.current = false;
      if (owner.isCurrent() && mounted.current) setBusy(false);
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
        <ProfileAvatar name={name || "You"} photoUrl={photo} size={72} />
        <GalleryButton
          label={photo ? "Change photo" : "Add a photo"}
          disabled={busy}
          onPress={() => {
            void choose();
          }}
        />
      </View>
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
      <ProfileField
        label="Bio (optional)"
        accessibilityLabel="Bio"
        value={bio}
        onChangeText={setBio}
        maxLength={LIMITS.bio}
        multiline
        editable={!busy && !profileCreated}
      />
      <Text style={{ fontSize: 13, lineHeight: 18, color: Gallery.muted }}>
        Your name, photo and bio appear on your public profile. Visits and private notes are separate.
      </Text>
      {error && (
        <Text accessibilityRole="alert" style={{ color: Gallery.destructive }}>
          {error}
        </Text>
      )}
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
      {profileCreated && error && (
        <GalleryButton label="Continue without photo" fullWidth disabled={busy} onPress={onCreated} />
      )}
    </ScrollView>
  );
}
