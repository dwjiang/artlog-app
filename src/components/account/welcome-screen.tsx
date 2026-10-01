import { useRouter } from "expo-router";
import { type ReactNode, useRef, useState } from "react";
import { KeyboardAvoidingView, ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from "react-native";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GalleryButton } from "@/components/collection/gallery-button";
import { ProfileAvatar } from "@/components/social/profile-avatar";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, Radius, Spacing, Typography } from "@/constants/theme";
import { setSetting } from "@/db/repos/settings";
import { WELCOME_SEEN_SETTING } from "@/lib/account/introduction";
import { setLocalProfileName, useLocalProfileName } from "@/lib/account/local-profile";
import { reportError } from "@/lib/observability";
import { LIMITS } from "@/shared/journal/limits";

import { useWelcomeAccess, type AccessStep } from "./welcome-access";
import { AccessArt, WelcomeArt } from "./welcome-art";

const BRAND_STATEMENT = "Point at a painting. Learn its story.";

export function WelcomeScreen() {
  const router = useRouter();
  const { top, bottom } = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const reduced = useReducedMotion();
  const pager = useRef<Animated.ScrollView>(null);
  const scrollX = useSharedValue(0);
  const [index, setIndex] = useState(0);
  // Each page's picture plays its entrance once, the first time the page arrives.
  const [reached, setReached] = useState(0);
  const localProfile = useLocalProfileName();
  const [draft, setDraft] = useState<string>();
  const name = draft ?? localProfile.name ?? "";
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState<string>();
  const access = useWelcomeAccess();
  const count = access.steps.length + 2;
  const last = index === count - 1;
  const step = index === 0 ? undefined : access.steps[index - 1];
  const onScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollX.set(event.contentOffset.x);
    },
  });
  // Pages change only through their buttons, so a swipe can never pass a permission without an answer.
  const goTo = (page: number) => {
    pager.current?.scrollTo({ x: page * width, animated: !reduced });
    setIndex(page);
    setReached((furthest) => Math.max(furthest, page));
  };
  const advance = () => goTo(Math.min(index + 1, count - 1));
  const allow = async (current: AccessStep) => {
    await access.answer(current);
    advance();
  };
  const finish = async () => {
    if (!name.trim() || localProfile.loading || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(undefined);
    try {
      await setLocalProfileName(name);
      await setSetting(WELCOME_SEEN_SETTING, "true");
      router.back();
    } catch (cause) {
      reportError(cause, "account.welcome.save");
      setError("Your name couldn’t be saved. Please try again.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={styles.root}>
      <View style={[styles.root, { paddingTop: top + Spacing.two, paddingBottom: Math.max(Spacing.four, bottom) }]}>
        <View style={styles.header}>
          <View
            pointerEvents={index === 0 ? "none" : "auto"}
            accessibilityElementsHidden={index === 0}
            importantForAccessibility={index === 0 ? "no-hide-descendants" : "auto"}
            style={{ opacity: index === 0 ? 0 : 1 }}
          >
            <GalleryButton
              label="Back"
              icon="chevron.left"
              iconOnly
              fullWidth={false}
              disabled={saving}
              onPress={() => goTo(Math.max(index - 1, 0))}
            />
          </View>
          <View accessible accessibilityLabel={`Page ${index + 1} of ${count}`} style={styles.progress}>
            {Array.from({ length: count }, (_, position) => (
              <ProgressSegment key={position} position={position} scrollX={scrollX} width={width} />
            ))}
          </View>
        </View>
        <Animated.ScrollView
          ref={pager}
          horizontal
          pagingEnabled
          scrollEnabled={false}
          keyboardShouldPersistTaps="handled"
          showsHorizontalScrollIndicator={false}
          scrollEventThrottle={16}
          onScroll={onScroll}
          style={styles.pager}
        >
          <WelcomePage active={index === 0} width={width}>
            <Text accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.wordmark}>
              Artlog
            </Text>
            <View style={styles.art}>
              <WelcomeArt />
            </View>
            <Headline accessibilityLabel={`Welcome to Artlog. ${BRAND_STATEMENT}`}>{BRAND_STATEMENT}</Headline>
          </WelcomePage>
          {access.steps.map((current, position) => (
            <WelcomePage key={current.key} active={index === position + 1} width={width}>
              <View style={styles.art}>
                <AccessArt step={current.key} shown={reached > position} />
              </View>
              <View style={styles.copy}>
                <Headline>{current.headline}</Headline>
                <Text themeColor="textSecondary">{current.caption}</Text>
              </View>
            </WelcomePage>
          ))}
          <WelcomePage active={last} width={width}>
            <View style={styles.art}>
              <View style={styles.nameCard}>
                <ProfileAvatar name={name.trim() || undefined} size={96} />
                <TextInput
                  accessibilityLabel="Name"
                  value={name}
                  onChangeText={setDraft}
                  placeholder="Name or nickname"
                  placeholderTextColor={Gallery.muted}
                  selectionColor={Gallery.accent}
                  keyboardAppearance="light"
                  maxLength={LIMITS.name}
                  textContentType="name"
                  autoCapitalize="words"
                  autoCorrect={false}
                  returnKeyType="done"
                  editable={!saving && !localProfile.loading}
                  onSubmitEditing={() => void finish()}
                  style={styles.nameInput}
                />
              </View>
            </View>
            <View style={styles.copy}>
              <Headline>Your name.</Headline>
              {error && (
                <Text accessibilityRole="alert" style={{ color: Gallery.destructive }}>
                  {error}
                </Text>
              )}
            </View>
          </WelcomePage>
        </Animated.ScrollView>
        <View style={styles.actions}>
          {/* Two rows on every page, so the pages above keep their height when the button count changes. */}
          {!step || step.answer !== "unanswered" ? (
            <View
              pointerEvents="none"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={{ opacity: 0 }}
            >
              <GalleryButton label="Not now" fullWidth variant="filled" tone="neutral" disabled onPress={advance} />
            </View>
          ) : null}
          {last ? (
            <GalleryButton
              label="Continue"
              fullWidth
              variant="filled"
              disabled={!name.trim() || localProfile.loading}
              busy={saving}
              busyLabel="Saving…"
              onPress={() => void finish()}
            />
          ) : step ? (
            <>
              <GalleryButton
                label={step.answer === "unanswered" ? `Allow ${step.name}` : "Continue"}
                fullWidth
                variant="filled"
                busy={access.asking === step.key}
                busyLabel="Asking…"
                onPress={() => void allow(step)}
              />
              {step.answer === "unanswered" && (
                <GalleryButton label="Not now" fullWidth variant="filled" tone="neutral" onPress={advance} />
              )}
            </>
          ) : (
            <GalleryButton label="Get started" fullWidth variant="filled" onPress={advance} />
          )}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function WelcomePage({ active, width, children }: { active: boolean; width: number; children: ReactNode }) {
  return (
    <ScrollView
      style={{ width }}
      accessibilityElementsHidden={!active}
      importantForAccessibility={active ? "auto" : "no-hide-descendants"}
      contentInsetAdjustmentBehavior="never"
      alwaysBounceVertical={false}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.page}
    >
      {children}
    </ScrollView>
  );
}

function Headline({ accessibilityLabel, children }: { accessibilityLabel?: string; children: string }) {
  const { fontScale } = useWindowDimensions();
  return (
    <Text
      accessibilityRole="header"
      accessibilityLabel={accessibilityLabel}
      style={fontScale > 1.3 ? Typography.display : styles.title}
    >
      {children}
    </Text>
  );
}

function ProgressSegment({
  position,
  scrollX,
  width,
}: {
  position: number;
  scrollX: SharedValue<number>;
  width: number;
}) {
  const fill = useAnimatedStyle(() => ({
    transform: [
      {
        scaleX: interpolate(scrollX.get() / width, [position - 1, position], [0, 1], Extrapolation.CLAMP),
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
  root: { flex: 1, backgroundColor: Gallery.paper },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingLeft: Spacing.compact,
    paddingRight: Spacing.content,
  },
  progress: { flex: 1, flexDirection: "row", gap: Spacing.one },
  track: { flex: 1, height: 3, borderRadius: Radius.full, overflow: "hidden", backgroundColor: Gallery.softBorder },
  fill: { flex: 1, backgroundColor: Gallery.ink, transformOrigin: "left" },
  pager: { flex: 1 },
  page: { flexGrow: 1, paddingHorizontal: Spacing.content, paddingTop: Spacing.two, gap: Spacing.four },
  wordmark: { ...Typography.wordmark, fontSize: 26, lineHeight: 34, letterSpacing: -0.8, color: Gallery.ink },
  art: { flex: 1, minHeight: 220, justifyContent: "center" },
  copy: { gap: Spacing.two },
  nameCard: {
    alignItems: "center",
    gap: Spacing.content,
    paddingHorizontal: Spacing.content,
    paddingVertical: Spacing.five,
    borderRadius: Radius.card,
    backgroundColor: Gallery.fill,
  },
  nameInput: {
    ...Typography.display,
    fontSize: 34,
    lineHeight: 44,
    alignSelf: "stretch",
    textAlign: "center",
    color: Gallery.ink,
  },
  title: { ...Typography.display, fontSize: 36, lineHeight: 47, color: Gallery.ink },
  actions: { gap: Spacing.compact, paddingHorizontal: Spacing.content, paddingTop: Spacing.three },
});
