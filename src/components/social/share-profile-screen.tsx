import { File } from "expo-file-system";
import { Image } from "expo-image";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { useRouter, useLocalSearchParams } from "expo-router";
import * as Sharing from "expo-sharing";
import createQrCode from "qrcode-generator";
import { useMemo, useRef, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ActionStack } from "@/components/action-stack";
import { GalleryButton } from "@/components/collection/gallery-button";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, Radius, Spacing } from "@/constants/theme";
import { reportError } from "@/lib/observability";
import type { PublicProfile } from "@/lib/social/types";
import { useSocialQuery } from "@/lib/social/use-social-query";
import { useSocialSession } from "@/lib/social/use-social-session";
import { showErrorToast } from "@/lib/ui/toast";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { ProfileAvatar } from "./profile-avatar";
import { SocialGate, SocialState } from "./social-state";

export function ShareProfileScreen() {
  const session = useSocialSession();
  const router = useRouter();
  const { profileId } = useLocalSearchParams<{ profileId?: string }>();
  const profile = useSocialQuery(
    api.profiles.getPublic,
    profileId || session.profileId ? { profileId: (profileId ?? session.profileId!) as Id<"profiles"> } : "skip",
    session.key,
  );
  if (!profileId && session.status !== "ready") {
    return <SocialGate session={session} />;
  }
  if (profile.data === null) {
    return (
      <SocialState
        title="Profile unavailable."
        detail="This public profile is no longer available."
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
  return <ShareProfileContent key={`${session.key}:${profile.data.profileId}`} person={profile.data} />;
}

function ShareProfileContent({ person }: { person: PublicProfile }) {
  const router = useRouter();
  const { bottom } = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const sharing = useRef(false);
  const code = useMemo(() => {
    const qr = createQrCode(0, "M");
    qr.addData(`artlog://profile/${encodeURIComponent(person.profileId)}`);
    qr.make();
    // 24 px per module keeps the code crisp at 3x display scale and in the shared PNG; the margin is the four-module quiet zone.
    return qr.createDataURL(24, 96);
  }, [person.profileId]);
  async function share() {
    if (sharing.current) return;
    sharing.current = true;
    setBusy(true);
    let uri: string | undefined;
    let context: ReturnType<typeof ImageManipulator.manipulate> | undefined;
    try {
      context = ImageManipulator.manipulate(code);
      const image = await context.renderAsync();
      try {
        uri = (await image.saveAsync({ format: SaveFormat.PNG })).uri;
      } finally {
        image.release();
      }
      await Sharing.shareAsync(uri, {
        mimeType: "image/png",
        UTI: "public.png",
        dialogTitle: `${person.name}’s Artlog profile`,
      });
    } catch (cause) {
      reportError(cause, "profile.share");
      showErrorToast("Couldn’t share your QR code.", () => void share());
    } finally {
      context?.release();
      if (uri) {
        try {
          new File(uri).delete();
        } catch {
          /* The cache can already have been cleared by iOS. */
        }
      }
      sharing.current = false;
      setBusy(false);
    }
  }
  return (
    <View collapsable={false} style={styles.root}>
      <ScrollView style={{ flex: 1 }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <ProfileAvatar name={person.name} photoUrl={person.photoUrl} avatar={person.avatar} size={52} />
          <View style={styles.identity}>
            <Text variant="display" accessibilityRole="header" style={styles.center}>
              {person.name}
            </Text>
            <Text variant="metadata" themeColor="textSecondary" style={styles.center}>
              @{person.username}
            </Text>
          </View>
          <Image
            accessible
            accessibilityLabel={`QR code for ${person.name}’s Artlog profile`}
            source={{ uri: code }}
            contentFit="contain"
            style={styles.code}
          />
          <Text variant="display">Artlog</Text>
          <Text variant="secondary" themeColor="textSecondary" style={styles.center}>
            Scan to view this profile in Artlog.
          </Text>
        </View>
      </ScrollView>
      <View collapsable={false} style={[styles.actions, { paddingBottom: Math.max(bottom, Spacing.three) }]}>
        <ActionStack textActions={<GalleryButton label="Done" fullWidth onPress={() => router.back()} />}>
          <GalleryButton
            label="Share QR code"
            icon="square.and.arrow.up"
            variant="filled"
            fullWidth
            busy={busy}
            busyLabel="Preparing QR code…"
            onPress={() => {
              void share();
            }}
          />
        </ActionStack>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Gallery.paper },
  content: {
    padding: Spacing.content,
    gap: Spacing.four,
    alignItems: "center",
    flexGrow: 1,
  },
  card: {
    width: "100%",
    maxWidth: 400,
    padding: Spacing.three,
    gap: Spacing.two,
    alignItems: "center",
    backgroundColor: Gallery.surface,
    borderRadius: Radius.sheet,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Gallery.softBorder,
  },
  identity: { gap: Spacing.one, alignItems: "center", width: "100%" },
  center: { textAlign: "center" },
  code: {
    width: "100%",
    maxWidth: 236,
    aspectRatio: 1,
    marginVertical: Spacing.one,
  },
  actions: {
    paddingHorizontal: Spacing.content,
    paddingTop: Spacing.compact,
  },
});
