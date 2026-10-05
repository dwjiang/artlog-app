import { Button, Host, Icon, Row, Text as NativeText } from "@expo/ui";
import { accessibilityLabel, contentShape, font, frame, shapes } from "@expo/ui/swift-ui/modifiers";
import Constants from "expo-constants";
import { Image } from "expo-image";
import { router } from "expo-router";
import { Children, Fragment, type ComponentProps, type ReactNode } from "react";
import { ScrollView, View } from "react-native";

import { GalleryButton } from "@/components/collection/gallery-button";
import { MotionPressable } from "@/components/motion-pressable";
import { ProfileAvatar } from "@/components/social/profile-avatar";
import { ThemedText } from "@/components/themed-text";
import { Gallery, SettingsOutline } from "@/constants/theme";
import { signInRoute } from "@/lib/account/sign-in-context";
import { useAccount } from "@/lib/account/use-account";
import { openLegalPage } from "@/lib/legal-links";
import { useSocialQuery } from "@/lib/social/use-social-query";
import { useSocialSession } from "@/lib/social/use-social-session";

import { api } from "../../../convex/_generated/api";

export function SettingsScreen() {
  const signIn = useAccount();
  const { account } = signIn;
  const session = useSocialSession();
  const { data: profile } = useSocialQuery(api.profiles.mine, session.status === "ready" ? {} : "skip", session.key);
  const detail = (section: string) => () => router.push({ pathname: "/settings-detail", params: { section } });
  const accountName = profile?.name ?? "Your Artlog account";
  const accountDetail = account?.linked ? (profile ? `@${profile.username}` : account.email) : undefined;
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: Gallery.paper }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        paddingHorizontal: 20,
        paddingTop: 8,
        paddingBottom: 28,
        gap: 16,
      }}
    >
      {account?.linked ? (
        <View style={{ gap: 12 }}>
          <MotionPressable
            accessibilityRole="button"
            accessibilityLabel={accountName}
            accessibilityHint="Manage your Artlog account"
            onPress={detail("account")}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 14,
              paddingBottom: 14,
              borderBottomWidth: 0.5,
              borderColor: Gallery.separator,
            }}
          >
            <ProfileAvatar name={profile?.name} photoUrl={profile?.photoUrl} avatar={profile?.avatar} size={64} />
            <View style={{ flex: 1, gap: 4 }}>
              <ThemedText variant="section" style={{ fontSize: 24, lineHeight: 28 }}>
                {accountName}
              </ThemedText>
              {!!accountDetail && (
                <ThemedText variant="metadata" themeColor="textSecondary">
                  {accountDetail}
                </ThemedText>
              )}
            </View>
            <Image
              source="sf:chevron.right"
              tintColor={Gallery.muted}
              style={{ width: 13, height: 13 }}
              accessible={false}
            />
          </MotionPressable>
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          <MotionPressable
            accessibilityRole="button"
            accessibilityLabel="Your collection"
            accessibilityHint="Manage your data"
            onPress={detail("account")}
            style={{
              padding: 16,
              gap: 12,
              flexDirection: "row",
              alignItems: "center",
              backgroundColor: Gallery.surface,
              borderRadius: 12,
              borderWidth: 0.5,
              borderColor: Gallery.softBorder,
            }}
          >
            <ProfileAvatar size={44} />
            <View style={{ flex: 1 }}>
              <ThemedText variant="button">Your collection</ThemedText>
              <ThemedText variant="metadata" themeColor="textSecondary">
                Saved on this iPhone
              </ThemedText>
            </View>
            <Image
              source="sf:chevron.right"
              tintColor={Gallery.muted}
              style={{ width: 13, height: 13 }}
              accessible={false}
            />
          </MotionPressable>
          <ThemedText variant="body" themeColor="textSecondary">
            Sign in to share your wall and connect with friends.
          </ThemedText>
          <GalleryButton
            label="Sign in"
            variant="filled"
            fullWidth
            onPress={() => router.push(signInRoute("account"))}
          />
        </View>
      )}
      <SettingsGroup title="App">
        <SettingsRow label="General" icon="gearshape" onPress={detail("general")} />
        <SettingsRow label="Notifications" icon="bell" onPress={detail("notifications")} />
        <SettingsRow label="Widgets" icon="square.grid.2x2" onPress={() => router.push("/widgets")} />
        {account?.linked && <SettingsRow label="Leaderboards" icon="trophy" onPress={detail("leaderboards")} />}
      </SettingsGroup>
      <SettingsGroup title="Legal">
        <SettingsRow label="About" icon="info.circle" onPress={detail("about")} />
        <SettingsRow label="Privacy Policy" icon="lock" external onPress={() => void openLegalPage("privacy")} />
        <SettingsRow label="Terms of Service" icon="doc.text" external onPress={() => void openLegalPage("terms")} />
      </SettingsGroup>
      <SettingsGroup title="Support">
        <SettingsRow label="Send feedback" icon="envelope" onPress={() => router.push("/send-feedback")} />
      </SettingsGroup>
      <ThemedText variant="metadata" themeColor="textSecondary">
        Artlog · Version {Constants.expoConfig?.version ?? Constants.nativeAppVersion ?? "Unknown"}
      </ThemedText>
      {__DEV__ && (
        <SettingsGroup title="Developer">
          <SettingsRow label="Developer Tools" icon="wrench.and.screwdriver" onPress={detail("developer")} />
        </SettingsGroup>
      )}
    </ScrollView>
  );
}

function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <ThemedText variant="section" accessibilityRole="header">
        {title}
      </ThemedText>
      <View
        style={{
          paddingHorizontal: 12,
          backgroundColor: Gallery.surface,
          ...SettingsOutline,
          overflow: "hidden",
        }}
      >
        {Children.toArray(children).map((row, index) => (
          <Fragment key={index}>
            {index > 0 && (
              <View
                style={{
                  height: SettingsOutline.borderWidth,
                  backgroundColor: SettingsOutline.borderColor,
                }}
              />
            )}
            {row}
          </Fragment>
        ))}
      </View>
    </View>
  );
}

function SettingsRow({
  label,
  icon,
  external = false,
  onPress,
}: {
  label: string;
  icon: ComponentProps<typeof Icon>["name"];
  /** Opens a web page instead of another screen. */
  external?: boolean;
  onPress: () => void;
}) {
  return (
    <Host matchContents={{ vertical: true }} colorScheme="light" style={{ width: "100%" }}>
      <Button variant="text" onPress={onPress} modifiers={[accessibilityLabel(label), frame({ maxWidth: Infinity })]}>
        <Row
          spacing={16}
          alignment="center"
          modifiers={[frame({ maxWidth: Infinity, minHeight: 54 }), contentShape(shapes.rectangle())]}
        >
          <Icon name={icon} size={22} color={Gallery.ink} modifiers={[frame({ width: 28 })]} />
          <NativeText
            textStyle={{ color: Gallery.ink }}
            modifiers={[font({ textStyle: "body" }), frame({ maxWidth: Infinity, alignment: "leading" })]}
          >
            {label}
          </NativeText>
          <Icon name={external ? "arrow.up.right" : "chevron.right"} size={13} color={Gallery.muted} />
        </Row>
      </Button>
    </Host>
  );
}
