import { useAction } from "convex/react";
import { useRouter } from "expo-router";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ActionStack } from "@/components/action-stack";
import { GalleryButton } from "@/components/collection/gallery-button";
import { GalleryIconButton } from "@/components/collection/gallery-icon-button";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, Spacing, Typography } from "@/constants/theme";
import { useLocalProfile } from "@/lib/account/local-profile";
import { captureOwner } from "@/lib/account/owner-store";
import { convexErrorCode } from "@/lib/network-error";
import { reportError } from "@/lib/observability";
import { profilePictureArgs, shownPicture, useProfilePictureDraft } from "@/lib/social/profile-picture";
import { useSocialQuery } from "@/lib/social/use-social-query";
import { useSocialSession } from "@/lib/social/use-social-session";
import { useUsernameCheck, usernameMessages } from "@/lib/social/use-username-check";
import { LIMITS } from "@/shared/journal/limits";
import { socialErrorMessage } from "@/shared/social/errors";
import { isAllowedIdentity } from "@/shared/social/offensive-text";

import { api } from "../../../convex/_generated/api";
import { ProfileAvatar } from "./profile-avatar";
import { ProfileField, UsernameField } from "./profile-fields";
import { ProfilePicturePicker } from "./profile-picture-picker";
import { SocialGate } from "./social-state";

const STEPS = ["username", "name", "photo"] as const;

export function ProfileSetupScreen({
  suggestedName = "",
  visitId,
  audience,
}: {
  suggestedName?: string;
  visitId?: string;
  audience?: "friends";
}) {
  const router = useRouter();
  const session = useSocialSession();
  const create = useAction(api.profiles.create);
  const saveProfile = useAction(api.profilePhotos.save);
  const [step, setStep] = useState(0);
  const [name, setName] = useState(suggestedName.slice(0, LIMITS.name));
  // Undefined follows the suggestion from the sign-in name until the person types a username.
  const [username, setUsername] = useState<string>();
  const localProfile = useLocalProfile();
  const { picture, choose } = useProfilePictureDraft();
  const [picking, setPicking] = useState(false);
  const [operation, setOperation] = useState<"username" | "name" | "picture">();
  const [error, setError] = useState<string>();
  const [created, setCreated] = useState(false);
  const [finished, setFinished] = useState(false);
  const [savedName, setSavedName] = useState("");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // The profile starts on the painting this person already had as a guest.
  const shown = shownPicture({ avatar: localProfile.avatar }, picture);
  const trimmedName = name.trim();
  const suggestedDisplayName = suggestedName.trim().slice(0, LIMITS.name);
  const suggestion = useSocialQuery(
    api.profiles.suggestUsername,
    username === undefined && suggestedDisplayName ? { name: suggestedDisplayName } : "skip",
    session.key,
  );
  const chosenUsername = username ?? suggestion.data ?? "";
  const check = useUsernameCheck(chosenUsername, session.key);
  // A profile that existed before setup opened needs no setup; the one claimed on the first step keeps the steps going.
  const done = finished || (session.status === "ready" && !created && operation !== "username");
  const mine = useSocialQuery(api.profiles.mine, done ? {} : "skip", session.key);
  const busy = operation !== undefined;

  function close() {
    router.back();
  }
  function finish() {
    session.refresh();
    setFinished(true);
  }
  function goTo(next: number) {
    setError(undefined);
    setStep(next);
  }
  // Claiming the username creates the profile, so a name taken by someone else surfaces on this step.
  async function claimUsername() {
    if (busy || session.status !== "profile-required" || (check !== "available" && check !== "unchecked")) return;
    const owner = captureOwner();
    // This step can't edit the name, so a disallowed suggested name is left for the name step to refuse.
    const initialName =
      suggestedDisplayName && isAllowedIdentity(suggestedDisplayName) ? suggestedDisplayName : chosenUsername;
    setOperation("username");
    setError(undefined);
    try {
      await create({ name: initialName, username: chosenUsername, avatar: localProfile.avatar });
      if (!owner.isOwnerCurrent() || !mounted.current) return;
      setSavedName(initialName);
      setUsername(chosenUsername);
      setCreated(true);
      setStep(1);
    } catch (cause) {
      const taken = convexErrorCode(cause) === "username_taken";
      if (!taken) reportError(cause, "profile.create");
      if (owner.isOwnerCurrent() && mounted.current) {
        setError(
          taken ? usernameMessages.taken : (socialErrorMessage(cause) ?? "Your username couldn’t be saved. Try again."),
        );
      }
    } finally {
      if (mounted.current) setOperation(undefined);
    }
  }
  async function confirmName() {
    if (busy || !trimmedName) return;
    if (trimmedName === savedName) {
      goTo(2);
      return;
    }
    const owner = captureOwner();
    setOperation("name");
    setError(undefined);
    try {
      await saveProfile({ name: trimmedName });
      if (!owner.isOwnerCurrent() || !mounted.current) return;
      setSavedName(trimmedName);
      setStep(2);
    } catch (cause) {
      reportError(cause, "profile.update");
      if (owner.isOwnerCurrent() && mounted.current) {
        setError(socialErrorMessage(cause) ?? "Your name wasn’t saved. Try again.");
      }
    } finally {
      if (mounted.current) setOperation(undefined);
    }
  }
  async function savePicture() {
    if (busy) return;
    if (!picture) {
      finish();
      return;
    }
    const owner = captureOwner();
    setOperation("picture");
    setError(undefined);
    try {
      const pictureArgs = await profilePictureArgs(picture);
      if (!owner.isOwnerCurrent() || !mounted.current) return;
      await saveProfile({ name: savedName, ...pictureArgs });
      if (owner.isOwnerCurrent() && mounted.current) finish();
    } catch (cause) {
      reportError(cause, "profile.photo.save");
      if (owner.isOwnerCurrent() && mounted.current) {
        setError(
          picture.kind === "photo"
            ? "The photo couldn’t upload. Try again or continue without it."
            : "Your picture wasn’t saved. Try again.",
        );
      }
    } finally {
      if (mounted.current) setOperation(undefined);
    }
  }

  if (done) {
    const profile = mine.data;
    const shownUsername = profile?.username ?? (created ? chosenUsername : undefined);
    return (
      <SetupPage>
        <View style={styles.summary}>
          <ProfileAvatar
            name={profile?.name ?? trimmedName}
            photoUrl={profile ? profile.photoUrl : shown.photoUrl}
            avatar={profile?.avatar ?? shown.avatar}
            size={112}
          />
          <View style={styles.identity}>
            <Text variant="section" style={styles.centered}>
              {profile?.name ?? (savedName || trimmedName)}
            </Text>
            {shownUsername && (
              <Text themeColor="textSecondary" style={styles.centered}>
                @{shownUsername}
              </Text>
            )}
          </View>
        </View>
        <Heading
          centered
          title="Your profile is ready."
          detail={
            visitId
              ? "Next, choose what to share from your visit."
              : "Find friends to see the museum visits they share."
          }
        />
        <ActionStack textActions={<GalleryButton label="Done" fullWidth onPress={close} />}>
          {visitId ? (
            <GalleryButton
              label="Continue to sharing"
              variant="filled"
              fullWidth
              onPress={() =>
                router.replace({
                  pathname: "/visit-share/[visitId]",
                  params: { visitId, ...(audience ? { audience } : {}) },
                })
              }
            />
          ) : (
            <GalleryButton
              label="Find friends"
              variant="filled"
              fullWidth
              onPress={() => router.dismissTo("/people")}
            />
          )}
        </ActionStack>
      </SetupPage>
    );
  }

  const bar = (
    <View style={styles.bar}>
      {/* The username is claimed on the first step, so only the photo step can go back. */}
      {STEPS[step] === "photo" ? (
        <GalleryIconButton
          label="Back"
          icon="chevron.left"
          tone="accent"
          disabled={busy}
          onPress={() => goTo(step - 1)}
        />
      ) : (
        <View style={styles.barSpacer} />
      )}
      <View style={styles.chip}>
        <Text style={styles.chipText}>{`Step ${step + 1} of ${STEPS.length}`}</Text>
      </View>
      <GalleryButton label="Not Now" fullWidth={false} disabled={busy} onPress={close} />
    </View>
  );

  if (session.status === "signed-out" || session.status === "error") {
    return (
      <SetupPage bar={bar}>
        <SocialGate session={session} context="account" />
      </SetupPage>
    );
  }

  const errorText = error && (
    <Text accessibilityRole="alert" style={styles.error}>
      {error}
    </Text>
  );

  if (STEPS[step] === "username") {
    const waiting = session.status === "loading";
    return (
      <SetupPage bar={bar}>
        <Heading title="Your username" detail="Friends can find you by it. You can change it later." />
        <UsernameField
          value={chosenUsername}
          onChangeText={(value) => {
            setError(undefined);
            setUsername(value);
          }}
          check={check}
          placeholder={suggestion.loading ? "Finding a username…" : "username"}
          editable={!busy}
          autoFocus
          onSubmitEditing={() => {
            void claimUsername();
          }}
        />
        {check !== "taken" && errorText}
        {session.offline && <Text style={styles.footnote}>Connect to the internet to choose a username.</Text>}
        <GalleryButton
          label="Continue"
          variant="filled"
          fullWidth
          busy={operation === "username" || waiting}
          busyLabel={waiting ? "Finishing sign-in…" : "Saving username…"}
          disabled={session.offline || (check !== "available" && check !== "unchecked")}
          onPress={() => {
            void claimUsername();
          }}
        />
      </SetupPage>
    );
  }

  if (STEPS[step] === "name") {
    return (
      <SetupPage bar={bar}>
        <Heading title="Your name" detail="It appears on your profile and on visits you share." />
        <ProfileField
          label="Name"
          value={name}
          onChangeText={(value) => {
            setError(undefined);
            setName(value);
          }}
          maxLength={LIMITS.name}
          editable={!busy}
          autoFocus
          textContentType="name"
          autoComplete="name"
          onSubmitEditing={() => {
            void confirmName();
          }}
        />
        {errorText}
        <GalleryButton
          label="Continue"
          variant="filled"
          fullWidth
          busy={operation === "name"}
          busyLabel="Saving name…"
          disabled={!trimmedName}
          onPress={() => {
            void confirmName();
          }}
        />
      </SetupPage>
    );
  }

  return (
    <SetupPage bar={bar}>
      <Heading title="Your picture" detail="It appears on your public profile." />
      <View style={styles.photo}>
        <ProfileAvatar name={savedName} photoUrl={shown.photoUrl} avatar={shown.avatar} size={112} />
        <GalleryButton label="Change picture" disabled={busy} onPress={() => setPicking(true)} />
      </View>
      <ProfilePicturePicker
        visible={picking}
        name={savedName}
        shown={shown}
        onCancel={() => setPicking(false)}
        onSave={(next) => {
          setError(undefined);
          choose(next);
          setPicking(false);
        }}
      />
      {errorText}
      <ActionStack
        textActions={
          error
          && picture?.kind === "photo" && (
            <GalleryButton label="Continue without photo" fullWidth disabled={busy} onPress={finish} />
          )
        }
      >
        <GalleryButton
          label={picture ? "Save picture" : "Continue"}
          variant="filled"
          fullWidth
          busy={operation === "picture"}
          busyLabel={picture?.kind === "photo" ? "Uploading photo…" : "Saving picture…"}
          onPress={() => {
            void savePicture();
          }}
        />
      </ActionStack>
    </SetupPage>
  );
}

function SetupPage({ bar, children }: { bar?: ReactNode; children: ReactNode }) {
  const { top, bottom } = useSafeAreaInsets();
  return (
    <ScrollView
      style={styles.root}
      contentInsetAdjustmentBehavior="never"
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[
        styles.content,
        { paddingTop: top + Spacing.two, paddingBottom: Math.max(Spacing.four, bottom) },
      ]}
    >
      {bar}
      {children}
    </ScrollView>
  );
}

function Heading({ title, detail, centered = false }: { title: string; detail: string; centered?: boolean }) {
  const { fontScale } = useWindowDimensions();
  return (
    <View style={styles.heading}>
      <Text
        accessibilityRole="header"
        variant={fontScale > 1.3 ? "display" : "pageTitle"}
        style={centered && styles.centered}
      >
        {title}
      </Text>
      <Text themeColor="textSecondary" style={centered && styles.centered}>
        {detail}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Gallery.paper },
  content: {
    flexGrow: 1,
    paddingHorizontal: Spacing.content,
    gap: Spacing.four,
    maxWidth: 520,
    width: "100%",
    alignSelf: "center",
  },
  bar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44 },
  barSpacer: { width: 44, height: 44 },
  chip: {
    backgroundColor: Gallery.highlight,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
  chipText: { ...Typography.metadata, fontWeight: "600", color: Gallery.ink },
  heading: { gap: Spacing.compact },
  photo: { alignItems: "center", gap: Spacing.two },
  footnote: { fontSize: 13, lineHeight: 18, color: Gallery.muted },
  error: { fontSize: 14, lineHeight: 20, color: Gallery.destructive },
  summary: { alignItems: "center", gap: Spacing.three, paddingTop: Spacing.five },
  identity: { alignItems: "center", gap: Spacing.half },
  centered: { textAlign: "center" },
});
