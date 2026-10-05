import { Stack, useRouter } from "expo-router";
import { useEffect } from "react";
import { ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";

import { ActionStack } from "@/components/action-stack";
import { GalleryButton } from "@/components/collection/gallery-button";
import { GalleryIconButton } from "@/components/collection/gallery-icon-button";
import { ArtworkStrip } from "@/components/guest/artwork-preview";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, Typography } from "@/constants/theme";
import { useFittedFormSheetStyle } from "@/hooks/use-fitted-sheet";
import { useLocalOwner } from "@/lib/account/owner-store";
import { profileSetupRoute, takeProfileSetupOffer, useProfileSetupOffer } from "@/lib/account/profile-setup-offer";
import { signInContexts, type SignInContext } from "@/lib/account/sign-in-context";
import { useAccount } from "@/lib/account/use-account";

import { SignInActions } from "./sign-in-actions";

export function SignInScreen({
  context = "account",
  visitId,
  audience,
}: {
  context?: SignInContext;
  visitId?: string;
  audience?: "friends";
}) {
  const state = useAccount();
  const { account, busy } = state;
  const owner = useLocalOwner();
  const router = useRouter();
  const { fontScale } = useWindowDimensions();
  const sheetStyle = useFittedFormSheetStyle();
  const copy = signInContexts[context];
  const continuingVisit = context === "visit" && !!visitId;
  const waitingForJournal = continuingVisit && !!account?.linked && owner !== `account:${account.accountId}`;
  const setupOffer = useProfileSetupOffer();
  useEffect(() => {
    if (!account?.linked || busy) return;
    // A first sign-in continues into profile setup; setup itself carries the visit on afterwards.
    if (setupOffer && account.hasProfile === false) {
      takeProfileSetupOffer();
      router.replace(profileSetupRoute(setupOffer, continuingVisit ? visitId : undefined, audience));
      return;
    }
    if (waitingForJournal) return;
    if (continuingVisit) {
      router.replace({
        pathname: "/visit-share/[visitId]",
        params: { visitId, ...(audience ? { audience } : {}) },
      });
    } else {
      router.back();
    }
  }, [
    account?.hasProfile,
    account?.linked,
    busy,
    continuingVisit,
    router,
    setupOffer,
    visitId,
    audience,
    waitingForJournal,
  ]);

  return (
    <>
      <Stack.Screen options={{ gestureEnabled: !busy }} />
      <ScrollView
        style={[styles.root, sheetStyle]}
        bounces={false}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
      >
        <View style={styles.preview}>
          <View style={styles.artworks}>
            <ArtworkStrip />
          </View>
          <GalleryIconButton label="Close sign-in" icon="xmark" disabled={busy} onPress={() => router.back()} />
        </View>
        <Text
          accessibilityRole="header"
          style={[styles.title, fontScale > 1.3 && { ...Typography.display, maxWidth: "100%" }]}
        >
          {copy.title}
        </Text>
        <Text style={styles.detail}>{copy.detail}</Text>
        <ActionStack
          style={styles.actions}
          textActions={<GalleryButton label="Not Now" fullWidth disabled={busy} onPress={() => router.back()} />}
        >
          {/* The chosen provider keeps its progress until the linked journal is ready to open. */}
          <SignInActions state={{ ...state, busy: busy || waitingForJournal }} />
        </ActionStack>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: Gallery.paper },
  content: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 20,
    gap: 12,
    maxWidth: 520,
    width: "100%",
    alignSelf: "center",
  },
  preview: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginBottom: 4,
  },
  artworks: { flex: 1 },
  title: {
    ...Typography.display,
    fontSize: 36,
    lineHeight: 42,
    maxWidth: 300,
    color: Gallery.ink,
  },
  detail: { ...Typography.body, color: Gallery.muted },
  actions: { paddingTop: 8 },
});
