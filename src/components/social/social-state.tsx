import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { View } from "react-native";

import { GalleryButton } from "@/components/collection/gallery-button";
import { EmptyState, EmptySymbol } from "@/components/empty-state";
import { LoadingRing } from "@/components/loading-ring";
import { FeedSkeleton, ListSkeleton, VisitSkeleton } from "@/components/loading-skeleton";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery } from "@/constants/theme";
import { signInRoute, type SignInContext } from "@/lib/account/sign-in-context";
import type { SocialSession } from "@/lib/social/use-social-session";
import { socialErrorMessage } from "@/shared/social/errors";

import { SocialInvitation } from "./social-invitation";
import { socialStyles } from "./social-styles";

export function SocialState({
  title,
  detail,
  icon = "rectangle.3.group",
  loading,
  action,
  onAction,
  secondaryAction,
  onSecondaryAction,
  centered,
}: {
  title: string;
  detail?: string;
  icon?: string;
  loading?: boolean;
  secondaryAction?: string;
  onSecondaryAction?: () => void;
  action?: string;
  onAction?: () => void;
  centered?: boolean;
}) {
  if (loading) {
    return (
      <View style={socialStyles.state}>
        <LoadingRing color={Gallery.accent} accessibilityLabel={title} />
      </View>
    );
  }
  return (
    <EmptyState title={title} detail={detail ?? ""} visual={<EmptySymbol name={icon} size={132} />} centered={centered}>
      {action && onAction && <GalleryButton label={action} onPress={onAction} variant="filled" fullWidth />}
      {secondaryAction && onSecondaryAction && (
        <GalleryButton label={secondaryAction} onPress={onSecondaryAction} fullWidth />
      )}
    </EmptyState>
  );
}

export function SocialGate({
  session,
  onBrowseGlobal,
  context = "friends",
}: {
  session: SocialSession;
  onBrowseGlobal?: () => void;
  context?: SignInContext;
}) {
  const router = useRouter();
  if (session.status === "ready") return null;
  if (session.status === "signed-out") {
    return (
      <SocialInvitation
        title={"Sign in to add friends."}
        detail="See the museum visits and artworks your friends share."
      >
        <GalleryButton label="Sign in" variant="filled" fullWidth onPress={() => router.push(signInRoute(context))} />
        {onBrowseGlobal && <GalleryButton label="Browse Global" fullWidth onPress={onBrowseGlobal} />}
      </SocialInvitation>
    );
  }
  if (session.status === "profile-required") {
    return (
      <SocialInvitation
        title="Create a public profile."
        detail="A public profile lets you find friends and follow their museum visits."
      >
        <GalleryButton
          label="Create your profile"
          variant="filled"
          fullWidth
          onPress={() => router.push("/create-profile")}
        />
        {onBrowseGlobal && <GalleryButton label="Browse Global" fullWidth onPress={onBrowseGlobal} />}
      </SocialInvitation>
    );
  }
  if (session.status === "offline") {
    return (
      <View>
        <SocialState
          title="You’re offline."
          detail="Your saved collection is still here. Shared visits will return when you’re connected."
          icon="wifi.slash"
          action="Open your collection"
          onAction={() => {
            router.dismissAll();
            router.navigate("/collection");
          }}
        />
        <View style={{ paddingHorizontal: 20 }}>
          <GalleryButton label="Try again" fullWidth onPress={session.refresh} />
        </View>
      </View>
    );
  }
  if (session.status === "error") {
    return (
      <SocialState
        title="Couldn’t load your account."
        detail={socialErrorMessage(session.error) ?? "Check your connection and try again."}
        action="Try again"
        onAction={session.refresh}
      />
    );
  }
  return <SocialState title="Loading your account…" loading />;
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
  skeleton?: "feed" | "list" | "gallery";
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
  if (!done) {
    return (
      <View style={socialStyles.footer}>
        <GalleryButton label={canLoadMore ? `More ${noun}` : "Try again"} onPress={canLoadMore ? loadMore : refresh} />
      </View>
    );
  }
  if (count > 0 && noun === "visits") {
    return (
      <View
        style={{
          alignItems: "center",
          paddingHorizontal: 20,
          paddingTop: 26,
          paddingBottom: 8,
          gap: 2,
        }}
      >
        <Text style={{ fontSize: 13, lineHeight: 20, color: Gallery.muted }}>All visits shown.</Text>
        <Text style={{ fontSize: 13, lineHeight: 18, color: Gallery.muted }}>
          Tap a name to view their public wall.
        </Text>
      </View>
    );
  }
  return count > 0 ? (
    <View style={socialStyles.footer}>
      <Image source="sf:checkmark.circle" tintColor={Gallery.muted} style={{ width: 22, height: 22 }} />
      <Text style={socialStyles.caption}>{`All ${noun} shown.`}</Text>
    </View>
  ) : null;
}
