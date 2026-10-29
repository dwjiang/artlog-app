import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from "react-native";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GalleryButton } from "@/components/collection/gallery-button";
import { GalleryIconButton } from "@/components/collection/gallery-icon-button";
import { GlassSurface } from "@/components/glass-surface";
import { MotionPressable } from "@/components/motion-pressable";
import { AskReasons, PermissionAsk } from "@/components/permissions/permission-ask";
import { ProfileAvatar } from "@/components/social/profile-avatar";
import { ProfilePicturePicker } from "@/components/social/profile-picture-picker";
import { ThemedText as Text } from "@/components/themed-text";
import { Fonts, Gallery, Radius, Spacing, Typography } from "@/constants/theme";
import { setSetting } from "@/db/repos/settings";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { WELCOME_SEEN_SETTING } from "@/lib/account/introduction";
import { setLocalProfileName, setLocalProfilePicture, useLocalProfile } from "@/lib/account/local-profile";
import { useLocalOwner } from "@/lib/account/owner-store";
import { profileSetupRoute, takeProfileSetupOffer } from "@/lib/account/profile-setup-offer";
import { answerSafetyChecks } from "@/lib/account/safety-checks-answer";
import { useAccount } from "@/lib/account/use-account";
import { reportError } from "@/lib/observability";
import { shownPicture, useProfilePictureDraft } from "@/lib/social/profile-picture";
import { useHorizontalSafeAreaPadding } from "@/lib/ui/safe-area";
import { LIMITS } from "@/shared/journal/limits";

import { LegalNotice } from "./legal-notice";
import { SignInActions } from "./sign-in-actions";
import { SignInHeader } from "./sign-in-header";
import { useWelcomeAccess, type AccessStep } from "./welcome-access";
import {
  AccessArt,
  CheckedComment,
  NameArt,
  SafetyChecksArt,
  SavedPhotoTile,
  ScanResult,
  SignInArt,
  WelcomeArt,
} from "./welcome-art";

const BRAND_STATEMENT = "Point at a painting. Learn its story.";
const SHEET_RADIUS = 28;
const HEADER_HEIGHT = Spacing.two + 44;

export function WelcomeScreen() {
  const router = useRouter();
  const { top, bottom } = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const headerPadding = useHorizontalSafeAreaPadding(styles.headerRow);
  const reduced = useReducedMotion();
  const pager = useRef<Animated.ScrollView>(null);
  const scrollX = useSharedValue(0);
  const [index, setIndex] = useState(0);
  // Each page's picture plays its entrance once, the first time the page arrives.
  const [reached, setReached] = useState(0);
  const localProfile = useLocalProfile();
  const [draft, setDraft] = useState<string>();
  const name = draft ?? localProfile.name ?? "";
  const { picture, choose, commit } = useProfilePictureDraft();
  const shown = shownPicture(localProfile, picture);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState<string>();
  const [answeringSafety, setAnsweringSafety] = useState<boolean>();
  const [safetyError, setSafetyError] = useState<string>();
  const access = useWelcomeAccess();
  const account = useAccount();
  // An account brings its own profile, so it skips the sign-in and name pages. Fixed when the welcome opens, so
  // signing in on the way through cannot reshuffle the pages under the visitor.
  const owner = useLocalOwner();
  const [guest] = useState(!owner.startsWith("account:"));
  const safetyPage = access.steps.length + 1;
  const signInPage = safetyPage + 1;
  const count = access.steps.length + (guest ? 4 : 2);
  const steps = count - 1;
  const finishing = useRef(false);
  const onScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollX.set(event.contentOffset.x);
    },
  });
  const controls = useAnimatedStyle(() => ({
    opacity: interpolate(scrollX.get(), [0, width], [0, 1], Extrapolation.CLAMP),
  }));
  // Pages change only through their buttons, so a swipe can never pass a permission without an answer.
  const goTo = (page: number) => {
    pager.current?.scrollTo({ x: page * width, animated: !reduced });
    setIndex(page);
    setReached((furthest) => Math.max(furthest, page));
  };
  const close = async () => {
    try {
      await setSetting(WELCOME_SEEN_SETTING, "true");
    } catch (cause) {
      reportError(cause, "account.welcome.save");
    }
    router.back();
  };
  const advance = () => (index >= count - 1 ? void close() : goTo(index + 1));
  const ask = async (current: AccessStep) => {
    await access.answer(current);
    advance();
  };
  const answerSafety = async (enabled: boolean) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setAnsweringSafety(enabled);
    setSafetyError(undefined);
    try {
      await answerSafetyChecks(enabled, !guest);
      advance();
    } catch (cause) {
      reportError(cause, "account.welcome.safety_checks");
      setSafetyError("Your choice couldn’t be saved. Please try again.");
    } finally {
      savingRef.current = false;
      setAnsweringSafety(undefined);
    }
  };
  useEffect(() => {
    // Signed in on the sign-in page: a new account continues into profile setup, an existing one is done.
    if (!guest || !account.account?.linked || account.busy || finishing.current) return;
    finishing.current = true;
    const { hasProfile } = account.account;
    void setSetting(WELCOME_SEEN_SETTING, "true")
      .catch((cause: unknown) => reportError(cause, "account.welcome.save"))
      .then(() => {
        const offer = hasProfile === false ? takeProfileSetupOffer() : undefined;
        if (offer) router.replace(profileSetupRoute(offer));
        else router.back();
      });
  }, [account.account, account.busy, guest, router]);

  const finish = async () => {
    if (localProfile.loading || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(undefined);
    let saved = "name";
    try {
      await setLocalProfileName(name);
      saved = "picture";
      await setLocalProfilePicture(picture);
      commit();
      await setSetting(WELCOME_SEEN_SETTING, "true");
      router.back();
    } catch (cause) {
      reportError(cause, "account.welcome.save");
      setError(`Your ${saved} couldn’t be saved. Please try again.`);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const sheetBottom = Math.max(Spacing.four, bottom);
  return (
    <KeyboardAvoidingView behavior="padding" style={styles.root}>
      <StatusBar style="light" />
      <Animated.ScrollView
        ref={pager}
        horizontal
        pagingEnabled
        scrollEnabled={false}
        keyboardShouldPersistTaps="handled"
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={onScroll}
        // Pages are the window's width, so a fold or rotation would leave the pager between two of them.
        onContentSizeChange={() => pager.current?.scrollTo({ x: index * width, animated: false })}
        style={styles.root}
      >
        <WelcomePage
          active={index === 0}
          width={width}
          art={(clear) => <WelcomeArt clear={clear} />}
          overlay={<ScanResult active={index === 0} />}
          bottom={sheetBottom}
          actions={
            <>
              <GalleryButton label="Get started" fullWidth variant="filled" onPress={advance} />
              <LegalNotice />
            </>
          }
        >
          <Text accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.wordmark}>
            Artlog
          </Text>
          <Headline accessibilityLabel={`Welcome to Artlog. ${BRAND_STATEMENT}`}>
            {"Point at a painting.\nLearn its story."}
          </Headline>
        </WelcomePage>
        {access.steps.map((current, position) => {
          const page = position + 1;
          return (
            <WelcomePage
              key={current.key}
              active={index === page}
              width={width}
              art={<AccessArt step={current.key} active={index === page} shown={reached >= page} />}
              overlay={current.key === "photos" ? <SavedPhotoTile shown={reached >= page} /> : undefined}
              bottom={sheetBottom}
              // App Review (5.1.1(iv)) rejects pre-prompts that say "Allow" or offer a way past the iPhone prompt.
              actions={
                <GalleryButton
                  label="Continue"
                  fullWidth
                  variant="filled"
                  busy={access.asking === current.key}
                  busyLabel="Asking…"
                  onPress={() => void ask(current)}
                />
              }
            >
              <PermissionAsk kind={current.key} />
            </WelcomePage>
          );
        })}
        <WelcomePage
          active={index === safetyPage}
          width={width}
          art={<SafetyChecksArt active={index === safetyPage} />}
          overlay={<CheckedComment shown={reached >= safetyPage} />}
          bottom={sheetBottom}
          // No iPhone prompt follows this page, so it holds the choice itself.
          actions={
            <>
              <GalleryButton
                label="Allow"
                fullWidth
                variant="filled"
                disabled={answeringSafety !== undefined}
                busy={answeringSafety === true}
                busyLabel="Saving…"
                onPress={() => void answerSafety(true)}
              />
              <GalleryButton
                label="Don’t Allow"
                fullWidth
                variant="filled"
                tone="neutral"
                disabled={answeringSafety !== undefined}
                busy={answeringSafety === false}
                busyLabel="Saving…"
                onPress={() => void answerSafety(false)}
              />
            </>
          }
        >
          <PermissionAsk kind="safetyChecks" />
          {safetyError && (
            <Text accessibilityRole="alert" style={{ color: Gallery.destructive }}>
              {safetyError}
            </Text>
          )}
        </WelcomePage>
        {guest && (
          <WelcomePage
            active={index === signInPage}
            width={width}
            art={<SignInArt />}
            bottom={sheetBottom}
            actions={
              <>
                <SignInActions state={account} />
                <GalleryButton
                  label="Not Now"
                  fullWidth
                  variant="filled"
                  tone="neutral"
                  disabled={account.busy}
                  onPress={advance}
                />
              </>
            }
          >
            <View style={styles.signIn}>
              <SignInHeader title="Save your collection." />
              <AskReasons
                reasons={[
                  { symbol: "person.2.fill", text: "Lets you share your wall and visits with friends." },
                  { symbol: "iphone", text: "Brings your collection and visits to a new iPhone when you sign in." },
                ]}
              />
            </View>
          </WelcomePage>
        )}
        {guest && (
          <WelcomePage
            active={index === count - 1}
            width={width}
            art={<NameArt active={index === count - 1} />}
            bottom={sheetBottom}
            actions={
              <GalleryButton
                label="Continue"
                fullWidth
                variant="filled"
                disabled={localProfile.loading}
                busy={saving}
                busyLabel="Saving…"
                onPress={() => void finish()}
              />
            }
          >
            <Headline>Your name.</Headline>
            <View style={styles.nameRow}>
              {/* The text button below is the accessible way to change the picture. */}
              <MotionPressable
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                disabled={saving}
                onPress={() => setPicking(true)}
              >
                <ProfileAvatar
                  name={name.trim() || undefined}
                  photoUrl={shown.photoUrl}
                  avatar={shown.avatar}
                  size={72}
                />
                <View style={styles.photoBadge}>
                  <Image source="sf:pencil" tintColor={Gallery.surface} style={styles.photoBadgeIcon} />
                </View>
              </MotionPressable>
              <TextInput
                accessibilityLabel="Name"
                value={name}
                onChangeText={setDraft}
                placeholder="Name or nickname"
                placeholderTextColor={Gallery.muted}
                selectionColor={Gallery.accent}
                keyboardAppearance="light"
                maxLength={LIMITS.name}
                textContentType="nickname"
                autoCapitalize="words"
                returnKeyType="done"
                editable={!saving && !localProfile.loading}
                onSubmitEditing={() => void finish()}
                style={styles.nameInput}
              />
            </View>
            <View style={styles.photoAction}>
              <GalleryButton
                label="Change picture"
                fullWidth={false}
                contentAlignment="leading"
                disabled={saving}
                onPress={() => setPicking(true)}
              />
            </View>
            <ProfilePicturePicker
              visible={picking}
              name={name.trim() || undefined}
              shown={shown}
              onCancel={() => setPicking(false)}
              onSave={(next) => {
                choose(next);
                setPicking(false);
              }}
            />
            {error && (
              <Text accessibilityRole="alert" style={{ color: Gallery.destructive }}>
                {error}
              </Text>
            )}
          </WelcomePage>
        )}
      </Animated.ScrollView>
      <View pointerEvents="box-none" style={[styles.header, { paddingTop: top }]}>
        <View pointerEvents="none" style={[styles.scrim, { height: top + 110 }]} />
        {/* The welcome is not a step, so the controls arrive with the first permission page. */}
        <Animated.View
          pointerEvents={index === 0 ? "none" : "box-none"}
          accessibilityElementsHidden={index === 0}
          importantForAccessibility={index === 0 ? "no-hide-descendants" : "auto"}
          style={[styles.headerRow, headerPadding, controls]}
        >
          <GlassSurface isInteractive style={styles.backGlass}>
            <GalleryIconButton
              label="Back"
              icon="chevron.left"
              tone="surface"
              size={17}
              disabled={saving || answeringSafety !== undefined}
              onPress={() => goTo(Math.max(index - 1, 0))}
            />
          </GlassSurface>
          <View accessible accessibilityLabel={`Step ${index} of ${steps}`} style={styles.progress}>
            {Array.from({ length: steps }, (_, position) => (
              <ProgressSegment key={position} page={position + 1} scrollX={scrollX} width={width} />
            ))}
          </View>
        </Animated.View>
      </View>
    </KeyboardAvoidingView>
  );
}

/**
 * One page: its picture fills the room above a white sheet holding the copy and the page's own buttons. A picture
 * drawn from a function learns the room it has clear of the status bar and the overlay.
 */
function WelcomePage({
  active,
  width,
  art,
  overlay,
  bottom,
  actions,
  children,
}: {
  active: boolean;
  width: number;
  art: ReactNode | ((clear: { top: number; bottom: number }) => ReactNode);
  overlay?: ReactNode;
  bottom: number;
  actions: ReactNode;
  children: ReactNode;
}) {
  const { top, left, right } = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [overlayHeight, setOverlayHeight] = useState(0);
  // Absolute overlays do not grow the scroll content; reserve their full height below the fixed header. The picture
  // gives up height in landscape so the copy and buttons stay in view.
  const artHeight = Math.max(
    Math.min(300, height / 2),
    top + HEADER_HEIGHT + Spacing.three + overlayHeight + SHEET_RADIUS,
  );
  return (
    <View
      style={{ width }}
      accessibilityElementsHidden={!active}
      importantForAccessibility={active ? "auto" : "no-hide-descendants"}
    >
      <ScrollView
        contentInsetAdjustmentBehavior="never"
        alwaysBounceVertical={false}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.page}
      >
        <View style={[styles.art, { minHeight: artHeight }]}>
          {typeof art === "function"
            ? art({ top: top + Spacing.three, bottom: overlayHeight + SHEET_RADIUS + Spacing.three })
            : art}
        </View>
        <View>
          <View style={[styles.sheet, { paddingBottom: bottom, paddingLeft: left, paddingRight: right }]}>
            <View style={styles.copy}>{children}</View>
            <View style={styles.actions}>{actions}</View>
          </View>
          {/* After the sheet, so a picture rising out of its edge draws on top of it. */}
          {overlay && (
            <View
              pointerEvents="box-none"
              onLayout={({ nativeEvent }) => setOverlayHeight(nativeEvent.layout.height)}
              style={[styles.overlay, { left, right }]}
            >
              {overlay}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function Headline({ accessibilityLabel, children }: { accessibilityLabel?: string; children: string }) {
  return (
    <Text accessibilityRole="header" accessibilityLabel={accessibilityLabel} style={styles.title}>
      {children}
    </Text>
  );
}

function ProgressSegment({ page, scrollX, width }: { page: number; scrollX: SharedValue<number>; width: number }) {
  const fill = useAnimatedStyle(() => ({
    transform: [
      {
        scaleX: interpolate(scrollX.get() / width, [page - 1, page], [0, 1], Extrapolation.CLAMP),
      },
    ],
  }));
  return (
    <View style={styles.track}>
      <Animated.View style={[styles.fill, fill]} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Gallery.ink },
  header: { position: "absolute", top: 0, left: 0, right: 0 },
  // Keeps the status bar and the white controls legible over bright paintings.
  scrim: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    experimental_backgroundImage:
      "linear-gradient(180deg, rgba(8,11,16,0.62) 0%, rgba(8,11,16,0.3) 55%, rgba(8,11,16,0) 100%)",
  },
  headerRow: {
    height: HEADER_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.compact,
    paddingTop: Spacing.two,
    paddingLeft: Spacing.compact,
    paddingRight: Spacing.content,
  },
  backGlass: { width: 44, height: 44, borderRadius: 22, overflow: "hidden" },
  progress: { flex: 1, flexDirection: "row", gap: Spacing.one },
  track: {
    flex: 1,
    height: 3,
    borderRadius: Radius.full,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.36)",
  },
  fill: { flex: 1, backgroundColor: Gallery.surface, transformOrigin: "left" },
  page: { flexGrow: 1 },
  art: { flex: 1, marginBottom: -SHEET_RADIUS, overflow: "hidden" },
  sheet: {
    paddingTop: SHEET_RADIUS,
    borderTopLeftRadius: SHEET_RADIUS,
    borderTopRightRadius: SHEET_RADIUS,
    backgroundColor: Gallery.paper,
    boxShadow: "0 -10px 30px -8px rgba(8,11,16,0.32)",
  },
  overlay: { position: "absolute", left: 0, right: 0, bottom: "100%" },
  copy: { gap: Spacing.two, paddingHorizontal: Spacing.content },
  actions: { gap: Spacing.two, paddingHorizontal: Spacing.content, paddingTop: Spacing.four },
  wordmark: { fontFamily: Fonts.display, fontSize: 20, lineHeight: 26, letterSpacing: -0.5, color: Gallery.ink },
  title: { ...Typography.display, color: Gallery.ink },
  signIn: { gap: Spacing.three },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 14, marginTop: Spacing.two },
  photoBadge: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2.5,
    borderColor: Gallery.surface,
    backgroundColor: Gallery.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  photoBadgeIcon: { width: 12, height: 12 },
  nameInput: {
    flex: 1,
    minHeight: 52,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.input,
    backgroundColor: Gallery.fill,
    fontSize: 17,
    color: Gallery.ink,
  },
  photoAction: { alignItems: "flex-start", marginTop: -Spacing.one },
});
