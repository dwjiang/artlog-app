import { ImageFormat, makeImageFromView } from "@shopify/react-native-skia";
import { File, Paths } from "expo-file-system";
import { Image } from "expo-image";
import { Asset, requestPermissionsAsync } from "expo-media-library";
import { useRouter, useLocalSearchParams } from "expo-router";
import * as Sharing from "expo-sharing";
import createQrCode from "qrcode-generator";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Linking, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";

import { LoadingRing } from "@/components/loading-ring";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, Radius, Spacing, Typography } from "@/constants/theme";
import { reportError } from "@/lib/observability";
import type { PublicProfile } from "@/lib/social/types";
import { useSocialQuery } from "@/lib/social/use-social-query";
import { useSocialSession } from "@/lib/social/use-social-session";
import { showErrorToast, showToast } from "@/lib/ui/toast";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { ProfileAvatar } from "./profile-avatar";
import { SocialGate, SocialState, StateScreen } from "./social-state";

const AVATAR_SIZE = 88;
const AVATAR_RING = 5;
// Fixed so the code keeps its size at large text; the narrowest iPhone card still fits it.
const QR_SIZE = 232;

export function ShareProfileScreen() {
  const session = useSocialSession();
  const router = useRouter();
  const { profileId } = useLocalSearchParams<{ profileId?: string }>();
  const profile = useSocialQuery(
    api.profiles.getPublic,
    profileId || session.profileId ? { profileId: (profileId ?? session.profileId!) as Id<"profiles"> } : "skip",
    session.key,
  );
  const gated = !profileId && session.status !== "ready";
  if (gated || !profile.data) {
    return (
      <StateScreen grouped>
        {gated ? (
          <SocialGate session={session} />
        ) : profile.data === null ? (
          <SocialState
            title="Profile unavailable."
            detail="This public profile is no longer available."
            action="Back"
            onAction={() => router.back()}
          />
        ) : (
          <SocialState
            title={profile.error ? "Couldn’t load your profile." : "Opening your profile…"}
            loading={!profile.error}
            action={profile.error ? "Try again" : undefined}
            onAction={profile.refresh}
          />
        )}
      </StateScreen>
    );
  }
  return (
    <ShareProfileContent
      key={`${session.key}:${profile.data.profileId}:${profile.data.photoUrl ?? ""}:${profile.data.avatar ?? ""}`}
      person={profile.data}
    />
  );
}

/** Draws the card as it appears on screen into a cache PNG, so the shared image always matches what the person sees. */
async function renderCard(card: RefObject<View | null>, name: string): Promise<File> {
  const image = await makeImageFromView(card);
  if (!image) throw new Error("The profile card could not be drawn.");
  try {
    const file = new File(Paths.cache, `${name}.png`);
    file.write(image.encodeToBytes(ImageFormat.PNG));
    return file;
  } finally {
    image.dispose();
  }
}

function ShareProfileContent({ person }: { person: PublicProfile }) {
  const { fontScale } = useWindowDimensions();
  const card = useRef<View>(null);
  const running = useRef(false);
  const [busy, setBusy] = useState<"share" | "save">();
  const [avatarReady, setAvatarReady] = useState<boolean>(!person.photoUrl && !person.avatar);
  const [qrReady, setQrReady] = useState(false);
  const [qrAttempt, setQrAttempt] = useState(0);
  const ready = avatarReady && qrReady;
  const code = useMemo(() => {
    const qr = createQrCode(0, "M");
    qr.addData(`artlog://profile/${encodeURIComponent(person.profileId)}`);
    qr.make();
    // 24 px per module stays crisp at 3x; the two-module margin plus the white card gives scanners their quiet zone.
    return qr.createDataURL(24, 48);
  }, [person.profileId]);

  async function run(action: "share" | "save") {
    if (running.current || !ready) return;
    running.current = true;
    setBusy(action);
    let file: File | undefined;
    try {
      if (action === "save") {
        const { granted } = await requestPermissionsAsync(true);
        if (!granted) {
          showToast("Allow Photos access in Settings to save your card.", {
            label: "Settings",
            onPress: () => void Linking.openSettings(),
          });
          return;
        }
      }
      file = await renderCard(card, `Artlog - ${person.username}`);
      if (action === "share") {
        await Sharing.shareAsync(file.uri, {
          mimeType: "image/png",
          UTI: "public.png",
          dialogTitle: `${person.name}’s Artlog profile`,
        });
      } else {
        await Asset.create(file.uri);
        showToast("Saved to Photos.");
      }
    } catch (cause) {
      reportError(cause, action === "share" ? "profile.share" : "profile.save_card");
      showErrorToast(
        action === "share" ? "Couldn’t share your profile card." : "Couldn’t save your card to Photos.",
        () => void run(action),
      );
    } finally {
      try {
        file?.delete();
      } catch {
        /* The cache can already have been cleared by iOS. */
      }
      running.current = false;
      setBusy(undefined);
    }
  }

  return (
    <ScrollView style={styles.root} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
      {/* The capture includes the gray margin so the overhanging avatar keeps its backdrop in the shared image. */}
      <View ref={card} collapsable={false} style={styles.capture}>
        <View style={styles.card}>
          <View style={styles.avatar}>
            <ProfileAvatar
              name={person.name}
              photoUrl={person.photoUrl}
              avatar={person.avatar}
              size={AVATAR_SIZE}
              onReady={() => setAvatarReady(true)}
            />
          </View>
          <View style={styles.identity}>
            <Text variant={fontScale >= 1.5 ? "section" : "display"} accessibilityRole="header" style={styles.center}>
              {person.name}
            </Text>
            <Text variant="secondary" themeColor="textSecondary" style={styles.center}>
              @{person.username}
            </Text>
          </View>
          <Image
            key={qrAttempt}
            accessible
            accessibilityLabel={`QR code for ${person.name}’s Artlog profile`}
            source={{ uri: code }}
            contentFit="contain"
            style={styles.code}
            onDisplay={() => setQrReady(true)}
            onError={() => {
              setQrReady(false);
              reportError(new Error("Profile QR code could not load"), "profile.qr");
              showErrorToast("Couldn’t load your QR code.", () => setQrAttempt((attempt) => attempt + 1), {
                quiet: true,
              });
            }}
          />
          {/* A logo, not reading text, so it keeps one size on screen and in the shared image. */}
          <Text variant="section" allowFontScaling={false} accessibilityElementsHidden>
            Artlog
          </Text>
        </View>
      </View>
      <View style={[styles.actions, fontScale >= 1.5 && styles.stacked]}>
        <ActionTile
          icon="square.and.arrow.up"
          label="Share"
          busyLabel="Preparing your card…"
          busy={busy === "share"}
          disabled={busy !== undefined || !ready}
          onPress={() => void run("share")}
        />
        <ActionTile
          icon="arrow.down.to.line"
          label="Save to Photos"
          busyLabel="Saving your card…"
          busy={busy === "save"}
          disabled={busy !== undefined || !ready}
          onPress={() => void run("save")}
        />
      </View>
      <Text variant="secondary" themeColor="textSecondary" style={[styles.center, styles.caption]}>
        Scan with the iPhone Camera to open in Artlog.
      </Text>
    </ScrollView>
  );
}

function ActionTile({
  icon,
  label,
  busyLabel,
  busy,
  disabled,
  onPress,
}: {
  icon: string;
  label: string;
  busyLabel: string;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  useEffect(() => {
    if (busy) AccessibilityInfo.announceForAccessibility(busyLabel);
  }, [busy, busyLabel]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityValue={busy ? { text: busyLabel } : undefined}
      accessibilityState={{ busy, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.tile, disabled && !busy && styles.disabled, pressed && styles.pressed]}
    >
      {busy ? (
        <LoadingRing size={22} accessible={false} />
      ) : (
        <Image source={`sf:${icon}`} tintColor={Gallery.accent} style={styles.tileIcon} accessible={false} />
      )}
      <Text style={styles.tileLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Gallery.groupedBackground },
  content: { paddingBottom: Spacing.four, alignItems: "center" },
  capture: {
    width: "100%",
    maxWidth: 440,
    paddingHorizontal: Spacing.content,
    paddingTop: AVATAR_SIZE / 2 + AVATAR_RING + Spacing.three,
    paddingBottom: Spacing.compact,
    backgroundColor: Gallery.groupedBackground,
  },
  card: {
    alignItems: "center",
    gap: Spacing.half,
    paddingTop: AVATAR_SIZE / 2 + Spacing.compact,
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.content,
    backgroundColor: Gallery.surface,
    borderRadius: Radius.sheet,
    borderCurve: "continuous",
  },
  avatar: {
    position: "absolute",
    top: -(AVATAR_SIZE / 2 + AVATAR_RING),
    padding: AVATAR_RING,
    borderRadius: Radius.full,
    backgroundColor: Gallery.surface,
  },
  identity: { width: "100%", alignItems: "center" },
  center: { textAlign: "center" },
  code: {
    width: QR_SIZE,
    height: QR_SIZE,
    marginTop: Spacing.compact,
    marginBottom: Spacing.two,
  },
  actions: {
    width: "100%",
    maxWidth: 440,
    flexDirection: "row",
    gap: Spacing.compact,
    paddingHorizontal: Spacing.content,
  },
  stacked: { flexDirection: "column" },
  tile: {
    flex: 1,
    minHeight: 76,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.two,
    padding: Spacing.compact,
    backgroundColor: Gallery.surface,
    borderRadius: Radius.card,
    borderCurve: "continuous",
  },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.5 },
  tileIcon: { width: 22, height: 22 },
  tileLabel: { ...Typography.secondary, fontWeight: "600", textAlign: "center" },
  caption: { maxWidth: 440, paddingHorizontal: Spacing.content, marginTop: Spacing.three },
});
