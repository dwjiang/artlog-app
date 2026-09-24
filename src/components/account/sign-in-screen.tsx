import { LoadingRing } from "@/components/loading-ring";
import { Stack, useRouter } from "expo-router";
import { useEffect } from "react";
import { ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { ThemedText as Text } from "@/components/themed-text";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GalleryButton } from "@/components/collection/gallery-button";
import { GalleryIconButton } from "@/components/collection/gallery-icon-button";
import { ArtworkStrip } from "@/components/guest/artwork-preview";
import { Gallery, Typography } from "@/constants/theme";
import { signInContexts, type SignInContext } from "@/lib/account/sign-in-context";
import { useAccount } from "@/lib/account/use-account";
import { useLocalOwner } from "@/lib/account/owner-store";
import { AppleSignInAction } from "./apple-sign-in-action";

export function SignInScreen({ context = "account", visitId }: { context?: SignInContext; visitId?: string }) {
  const state = useAccount();
  const { account, busy } = state;
  const owner = useLocalOwner();
  const router = useRouter();
  const { bottom } = useSafeAreaInsets();
  const { fontScale, height } = useWindowDimensions();
  const copy = signInContexts[context];
  const initialDetent = height < 760 ? 0.8 : context === "visit" ? 0.5 : 0.62;
  const continuingVisit = context === "visit" && !!visitId;
  const waitingForJournal = continuingVisit && !!account?.linked && owner !== `account:${account.accountId}`;
  useEffect(() => {
    if (!account?.linked || busy || waitingForJournal) return;
    if (continuingVisit) {
      router.replace({
        pathname: "/visit-share/[visitId]",
        params: { visitId },
      });
    } else router.back();
  }, [account?.linked, busy, continuingVisit, router, visitId, waitingForJournal]);

  return (
    <>
      <Stack.Screen
        options={{
          gestureEnabled: !busy,
          sheetAllowedDetents: fontScale > 1.3 ? [1] : [initialDetent, 1],
        }}
      />
      <ScrollView
        style={styles.root}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(20, bottom) }]}
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
        <View style={styles.actions}>
          {waitingForJournal && !busy ? (
            <View style={styles.preparing}>
              <LoadingRing accessibilityLabel="Syncing your journal…" color={Gallery.accent} />
            </View>
          ) : (
            <AppleSignInAction state={state} />
          )}
          <GalleryButton label="Not now" fullWidth disabled={busy} onPress={() => router.back()} />
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Gallery.paper },
  content: {
    paddingHorizontal: 20,
    paddingTop: 24,
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
  actions: { gap: 8, paddingTop: 8 },
  preparing: { minHeight: 50, alignItems: "center", gap: 8 },
});
