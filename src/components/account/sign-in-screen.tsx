import { Stack, useRouter } from "expo-router";
import { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";

import { GalleryIconButton } from "@/components/collection/gallery-icon-button";
import { SafeAreaScrollView } from "@/components/safe-area-scroll";
import { Gallery, Spacing } from "@/constants/theme";
import { useFittedFormSheetStyle } from "@/hooks/use-fitted-sheet";
import { useLocalOwner } from "@/lib/account/owner-store";
import { profileSetupRoute, takeProfileSetupOffer, useProfileSetupOffer } from "@/lib/account/profile-setup-offer";
import { signInTitles, type SignInContext } from "@/lib/account/sign-in-context";
import { useAccount } from "@/lib/account/use-account";

import { SignInActions } from "./sign-in-actions";
import { SignInHeader } from "./sign-in-header";

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
  const sheetStyle = useFittedFormSheetStyle();
  const continuingVisit = context === "visit" && !!visitId;
  const waitingForJournal = continuingVisit && !!account?.linked && owner !== `account:${account.accountId}`;
  const setupOffer = useProfileSetupOffer();
  // Taking the offer re-renders this sheet before the replace unmounts it; that render must not close setup again.
  const handedOff = useRef(false);
  useEffect(() => {
    if (!account?.linked || busy || handedOff.current) return;
    // A first sign-in continues into profile setup; setup itself carries the visit on afterwards.
    if (setupOffer && account.hasProfile === false) {
      handedOff.current = true;
      takeProfileSetupOffer();
      router.replace(profileSetupRoute(setupOffer, continuingVisit ? visitId : undefined, audience));
      return;
    }
    if (waitingForJournal) return;
    handedOff.current = true;
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
      <SafeAreaScrollView
        style={[styles.root, sheetStyle]}
        bounces={false}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
      >
        <View style={styles.close}>
          <GalleryIconButton label="Close sign-in" icon="xmark" disabled={busy} onPress={() => router.back()} />
        </View>
        <SignInHeader title={signInTitles[context]} />
        <View style={styles.actions}>
          {/* The chosen provider keeps its progress until the linked journal is ready to open. */}
          <SignInActions state={{ ...state, busy: busy || waitingForJournal }} />
        </View>
      </SafeAreaScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: Gallery.paper },
  content: {
    paddingHorizontal: Spacing.content,
    paddingTop: Spacing.five,
    paddingBottom: Spacing.content,
    gap: Spacing.three,
    maxWidth: 520,
    width: "100%",
    alignSelf: "center",
  },
  close: { position: "absolute", top: Spacing.compact, right: Spacing.compact },
  actions: { paddingTop: Spacing.two },
});
