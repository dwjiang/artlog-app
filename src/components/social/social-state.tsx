import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { View } from "react-native";

import { GalleryButton } from "@/components/collection/gallery-button";
import { EmptyActions, EmptyCard, EmptyState, EmptySymbol } from "@/components/empty-state";
import { LoadingRing } from "@/components/loading-ring";
import { FeedSkeleton, ListSkeleton, VisitSkeleton } from "@/components/loading-skeleton";
import { SafeAreaScrollView } from "@/components/safe-area-scroll";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, Spacing } from "@/constants/theme";
import { signInRoute, type SignInContext } from "@/lib/account/sign-in-context";
import type { SocialSession } from "@/lib/social/use-social-session";
import { socialErrorMessage } from "@/shared/social/errors";

import { SocialInvitation } from "./social-invitation";
import { socialStyles } from "./social-styles";

/** Holds a full-screen state below a transparent navigation bar, on paper or on the gray of a grouped page. */
export function StateScreen({
  grouped = false,
  scrollEnabled,
  children,
}: {
  grouped?: boolean;
  scrollEnabled?: boolean;
  children: ReactNode;
}) {
  return (
    <SafeAreaScrollView
      style={[socialStyles.root, grouped && { backgroundColor: Gallery.groupedBackground }]}
      contentInsetAdjustmentBehavior="automatic"
      bounces={false}
      scrollEnabled={scrollEnabled}
    >
      {children}
    </SafeAreaScrollView>
  );
}

export function SocialState({
  title,
  detail,
  icon = "rectangle.3.group",
  loading,
  action,
  onAction,
  secondaryAction,
  onSecondaryAction,
  card = false,
}: {
  title: string;
  detail?: string;
  icon?: string;
  loading?: boolean;
  secondaryAction?: string;
  onSecondaryAction?: () => void;
  action?: string;
  onAction?: () => void;
  /** Sets the state as a gray card under other content. */
  card?: boolean;
}) {
  if (loading) {
    return (
      <View style={socialStyles.state}>
        <LoadingRing color={Gallery.accent} accessibilityLabel={title} />
      </View>
    );
  }
  const primary = action && onAction ? { label: action, onPress: onAction } : undefined;
  const secondary =
    secondaryAction && onSecondaryAction ? { label: secondaryAction, onPress: onSecondaryAction } : undefined;
  if (card) return <EmptyCard title={title} detail={detail} action={primary} secondaryAction={secondary} />;
  return (
    <EmptyState title={title} detail={detail ?? ""} visual={<EmptySymbol name={icon} size={132} />}>
      <EmptyActions action={primary} secondaryAction={secondary} />
    </EmptyState>
  );
}

export const FRIENDS_SIGN_IN = {
  title: "Sign in to add friends.",
  detail: "See the museum visits and artworks your friends share.",
};

export function SocialGate({
  session,
  onBrowseGlobal,
  context = "friends",
  signedOut = FRIENDS_SIGN_IN,
  card = false,
}: {
  session: SocialSession;
  onBrowseGlobal?: () => void;
  context?: SignInContext;
  /** What signing in opens on this screen; pair it with the `context` whose sign-in title says the same. */
  signedOut?: { title: string; detail: string };
  /** Sets each state as a gray card under other content. */
  card?: boolean;
}) {
  const router = useRouter();
  if (session.status === "ready") return null;
  const browseGlobal = onBrowseGlobal && { label: "Browse Global", onPress: onBrowseGlobal };
  if (session.status === "signed-out") {
    return (
      <SocialInvitation
        card={card}
        {...signedOut}
        action={{ label: "Sign in", onPress: () => router.push(signInRoute(context)) }}
        secondaryAction={browseGlobal}
      />
    );
  }
  if (session.status === "profile-required") {
    return (
      <SocialInvitation
        card={card}
        title="Create a public profile."
        detail="A public profile lets you find friends and follow their museum visits."
        action={{ label: "Create your profile", onPress: () => router.push("/create-profile") }}
        secondaryAction={browseGlobal}
      />
    );
  }
  if (session.status === "offline") {
    return (
      <SocialState
        title="You’re offline."
        detail="Your saved collection is still here. Shared visits will return when you’re connected."
        icon="wifi.slash"
        card={card}
        action="Open your collection"
        onAction={() => {
          router.dismissAll();
          router.navigate("/collection");
        }}
        secondaryAction="Try again"
        onSecondaryAction={session.refresh}
      />
    );
  }
  if (session.status === "error") {
    return (
      <SocialState
        title="Couldn’t load your account."
        detail={socialErrorMessage(session.error) ?? "Check your connection and try again."}
        card={card}
        action="Try again"
        onAction={session.refresh}
      />
    );
  }
  return <SocialState title="Loading your account…" loading />;
}

/** A list shows only its first page's skeleton, so its page holds still; a pull-to-refresh keeps its gesture. */
export function loadingFirstPage(page: { loading: boolean; refreshing: boolean; error?: Error }, count: number) {
  return page.loading && !page.refreshing && !page.error && count === 0;
}

export function PageFooter({
  loading,
  error,
  done,
  count,
  loadMore,
  refresh,
  noun = "visits",
  canLoadMore,
  skeleton = "list",
}: {
  loading: boolean;
  error?: Error;
  done: boolean;
  count: number;
  loadMore: () => void;
  refresh: () => void;
  canLoadMore: boolean;
  noun?: string;
  /** `card` mirrors the white `ListRow` card of a grouped (gray) page. */
  skeleton?: "feed" | "list" | "card" | "gallery";
}) {
  const router = useRouter();
  if (loading && !error) {
    const label = `Loading ${noun}…`;
    if (count > 0) {
      return (
        <View style={socialStyles.footer}>
          <LoadingRing accessibilityLabel={label} />
        </View>
      );
    }
    if (skeleton === "feed") return <FeedSkeleton label={label} />;
    if (skeleton === "gallery") {
      return <VisitSkeleton label={label} heading={false} />;
    }
    if (skeleton === "card") {
      return (
        <View style={{ paddingHorizontal: Spacing.content }}>
          <ListSkeleton card label={label} avatar={noun === "friends"} />
        </View>
      );
    }
    return <ListSkeleton label={label} avatar={noun === "friends"} />;
  }
  if (error && count > 0) {
    return (
      <View style={{ padding: 20, gap: 4, alignItems: "center" }}>
        <Text style={socialStyles.caption}>Couldn’t load more {noun}.</Text>
        <GalleryButton label="Try loading more" onPress={canLoadMore ? loadMore : refresh} />
      </View>
    );
  }
  if (error) {
    return (
      <SocialState
        title={`Couldn’t load ${noun}.`}
        detail={socialErrorMessage(error) ?? "Please try again."}
        action="Try again"
        onAction={refresh}
        secondaryAction="Open your collection"
        onSecondaryAction={() => {
          router.dismissAll();
          router.navigate("/collection");
        }}
      />
    );
  }
  return done ? null : (
    <View style={socialStyles.footer}>
      <GalleryButton label={canLoadMore ? `More ${noun}` : "Try again"} onPress={canLoadMore ? loadMore : refresh} />
    </View>
  );
}
