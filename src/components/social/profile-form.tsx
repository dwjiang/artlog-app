import { reportError } from "@/lib/observability";
import {
  chooseProfilePhoto,
  profilePhotoBytes,
  removeProfilePhotoDraft,
} from "@/lib/social/profile-photo";
import { useAction, useMutation } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { ScrollView, TextInput, View } from "react-native";
import { api } from "../../../convex/_generated/api";
import { ThemedText as Text } from "@/components/themed-text";
import { GalleryButton } from "../collection/gallery-button";
import { Gallery } from "@/constants/theme";
import { captureOwner } from "@/lib/account/owner-store";
import { useSocialQuery } from "@/lib/social/use-social-query";
import { useSocialSession } from "@/lib/social/use-social-session";
import { socialErrorMessage } from "@/shared/social/errors";
import { validateProfile } from "@/shared/social/contracts";
import { LIMITS } from "@/shared/journal/limits";
import { ProfileAvatar } from "./profile-avatar";

export function ProfileForm({
  onCreated,
  introduction,
}: {
  onCreated: () => void;
  introduction: string;
}) {
  const create = useMutation(api.profiles.create);
  const savePhoto = useAction(api.profilePhotos.save);
  const [photo, setPhoto] = useState<string>();
  const [profileCreated, setProfileCreated] = useState(false);
  const photoDraft = useRef<string>(undefined),
    mounted = useRef(true),
    created = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      removeProfilePhotoDraft(photoDraft.current);
    };
  }, []);
  const session = useSocialSession();
  const [name, setName] = useState(""),
    [username, setUsername] = useState(""),
    [bio, setBio] = useState("");
  const [checkedUsername, setCheckedUsername] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  const submitting = useRef(false);
  const normalized = username.trim().toLowerCase();
  let validUsername = true;
  try {
    validateProfile({ name: "Validation", username: normalized });
  } catch {
    validUsername = false;
  }
  useEffect(() => {
    const timer = setTimeout(() => setCheckedUsername(normalized), 300);
    return () => clearTimeout(timer);
  }, [normalized]);
  const available = useSocialQuery(
    api.profiles.usernameAvailable,
    validUsername && normalized === checkedUsername
      ? { username: normalized }
      : "skip",
    session.key,
  );
  const usernameMessage = profileCreated
    ? "Username saved"
    : !username
      ? `Use ${LIMITS.usernameMin}–${LIMITS.usernameMax} lowercase letters, numbers or hyphens.`
      : !validUsername
        ? "Use lowercase letters, numbers and single hyphens between words."
        : normalized !== checkedUsername || available.loading
          ? "Checking username…"
          : available.error
            ? "Couldn’t check. You can try creating your profile."
            : available.data === false
              ? "That username is taken. Try another."
              : available.data
                ? "Username available"
                : "Checking username…";
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
    if (
      submitting.current
      || !name.trim()
      || (!created.current && (!validUsername || available.data === false))
    ) {
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
          username: normalized,
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
      reportError(
        cause,
        created.current ? "profile.photo.save" : "profile.create",
      );
      if (owner.isCurrent() && mounted.current) {
        setError(
          created.current
            ? "Your profile is ready, but the photo could not upload. Retry or continue without it."
            : (socialErrorMessage(cause)
                ?? "Your profile could not be created. Your edits are kept. Try again."),
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
        <Text style={{ color: Gallery.muted, fontSize: 15, lineHeight: 22 }}>
          {introduction}
        </Text>
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
      {[
        { label: "Name", value: name, change: setName, max: LIMITS.name },
        {
          label: "Username",
          value: username,
          change: setUsername,
          max: LIMITS.usernameMax,
        },
        { label: "Introduction", value: bio, change: setBio, max: LIMITS.bio },
      ].map((field) => (
        <View key={field.label} style={{ gap: 8 }}>
          <Text style={{ fontSize: 14, color: Gallery.ink }}>
            {field.label}
            {field.label === "Introduction" ? " (optional)" : ""}
          </Text>
          <TextInput
            accessibilityLabel={field.label}
            value={field.value}
            onChangeText={field.change}
            editable={!busy && !profileCreated}
            maxLength={field.max}
            multiline={field.label === "Introduction"}
            autoCapitalize={field.label === "Username" ? "none" : "sentences"}
            autoCorrect={field.label !== "Username"}
            keyboardAppearance="light"
            selectionColor={Gallery.accent}
            style={{
              padding: 14,
              minHeight: field.label === "Introduction" ? 100 : 48,
              textAlignVertical: "top",
              borderRadius: 8,
              borderWidth: 1,
              borderColor:
                field.label === "Username"
                && !profileCreated
                && username
                && (!validUsername || available.data === false)
                  ? Gallery.destructive
                  : Gallery.controlBorder,
              color: Gallery.ink,
              backgroundColor: Gallery.surface,
              fontSize: 17,
            }}
          />
          {field.label === "Username" && (
            <Text
              accessibilityLiveRegion="polite"
              style={{
                fontSize: 13,
                lineHeight: 18,
                color:
                  !profileCreated
                  && (available.data === false
                    || (!!username && !validUsername))
                    ? Gallery.destructive
                    : Gallery.muted,
              }}
            >
              {usernameMessage}
            </Text>
          )}
        </View>
      ))}
      <Text style={{ fontSize: 13, lineHeight: 18, color: Gallery.muted }}>
        Your name, photo and introduction appear on your public profile. Visits
        and private notes are separate.
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
        disabled={
          !name.trim()
          || (!profileCreated && (!validUsername || available.data === false))
        }
        onPress={() => {
          void submit();
        }}
      />
      {profileCreated && error && (
        <GalleryButton
          label="Continue without photo"
          fullWidth
          disabled={busy}
          onPress={onCreated}
        />
      )}
    </ScrollView>
  );
}
