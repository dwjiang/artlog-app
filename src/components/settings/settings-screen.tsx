import { Button, Host, Icon, Row, Text as NativeText } from '@expo/ui';
import { accessibilityLabel, contentShape, font, frame, shapes } from '@expo/ui/swift-ui/modifiers';
import { Children, Fragment, type ComponentProps, type ReactNode } from 'react';
import Constants from 'expo-constants';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, ScrollView, View, useWindowDimensions } from 'react-native';

import { Gallery } from '@/constants/theme';
import { GalleryButton } from '@/components/collection/gallery-button';
import { signInRoute } from '@/lib/account/sign-in-context';
import { useAccount } from '@/lib/account/use-account';
import { api } from '../../../convex/_generated/api';
import { useSocialSession } from '@/lib/social/use-social-session';
import { useSocialQuery } from '@/lib/social/use-social-query';
import { ProfileAvatar } from '../social/profile-avatar';
import { ThemedText } from '../themed-text';

export function SettingsScreen() {
  const { fontScale } = useWindowDimensions();
  const signIn = useAccount();
  const { account } = signIn;
  const session = useSocialSession();
  const { data: profile } = useSocialQuery(api.profiles.mine, session.status === 'ready' ? {} : 'skip', session.key);
  const detail = (section: string) => () => router.push({ pathname: '/settings-detail', params: { section } });
  const accountName = profile?.name ?? 'Your Artlog account';
  const accountDetail = account?.linked ? profile ? `@${profile.username}` : account.email : undefined;
  return <ScrollView style={{ flex: 1, backgroundColor: Gallery.paper }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 28, gap: 16 }}>
    <ThemedText variant={fontScale > 1.3 ? 'display' : 'pageTitle'} accessibilityRole="header">Settings</ThemedText>
    {account?.linked ? <View style={{ gap: 12 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={accountName} accessibilityHint="Manage your Artlog account"
        onPress={detail('account')}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingBottom: 14, borderBottomWidth: 0.5, borderColor: Gallery.separator }}>
        {profile ? <ProfileAvatar name={profile.name} photoUrl={profile.photoUrl} size={64} />
          : <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: Gallery.avatar, alignItems: 'center', justifyContent: 'center' }}>
            <Image source="sf:person.fill" tintColor={Gallery.ink} style={{ width: 28, height: 28 }} accessible={false} /></View>}
        <View style={{ flex: 1, gap: 4 }}>
          <ThemedText variant="section" style={{ fontSize: 24, lineHeight: 28 }}>{accountName}</ThemedText>
          {!!accountDetail && <ThemedText variant="metadata" themeColor="textSecondary">{accountDetail}</ThemedText>}
        </View>
        <Image source="sf:chevron.right" tintColor={Gallery.muted} style={{ width: 13, height: 13 }} accessible={false} />
      </Pressable>
    </View> : <View style={{ gap: 10 }}>
      <View style={{ padding: 16, gap: 12, flexDirection: 'row', alignItems: 'center', backgroundColor: Gallery.surface, borderRadius: 12, borderWidth: 0.5, borderColor: Gallery.softBorder }}>
        <ProfileAvatar name="Your collection" size={44} />
        <View style={{ flex: 1 }}><ThemedText variant="button">Your collection</ThemedText>
          <ThemedText variant="metadata" themeColor="textSecondary">Saved on this iPhone</ThemedText></View>
      </View>
      <ThemedText variant="display" accessibilityRole="header" style={{ fontSize: 28, lineHeight: 34 }}>Share your collection</ThemedText>
      <ThemedText variant="body" themeColor="textSecondary">Sign in to share your wall and connect with friends.</ThemedText>
      <GalleryButton label="Sign in" variant="filled" fullWidth onPress={() => router.push(signInRoute('account'))} />
    </View>}
    <SettingsGroup title="Your journal">
      <SettingsRow label="Visits" icon="chart.bar" onPress={detail('visits')} />
      {account?.linked && <SettingsRow label="Leaderboards" icon="trophy" onPress={detail('leaderboards')} />}
      {account?.linked && <SettingsRow label="Public notes" icon="text.bubble" onPress={() => router.push('/public-notes')} />}
      <SettingsRow label="Contributions" icon="person.2" onPress={detail('contributions')} />
      {!account?.linked && <SettingsRow label="Export journal" icon="square.and.arrow.down" onPress={detail('export')} />}
    </SettingsGroup>
    <SettingsGroup title={account?.linked ? 'Your data' : 'Artlog'}>
      {account?.linked && <SettingsRow label="Export journal" icon="square.and.arrow.down" onPress={detail('export')} />}
      <SettingsRow label="Privacy" icon="lock" onPress={detail('privacy')} />
      <SettingsRow label="About" icon="info.circle" onPress={detail('about')} />
    </SettingsGroup>
    <ThemedText variant="metadata" themeColor="textSecondary">Artlog · Version {Constants.expoConfig?.version ?? Constants.nativeAppVersion ?? 'Unknown'}</ThemedText>
    {__DEV__ && <SettingsGroup title="Developer"><SettingsRow label="Developer tools" icon="wrench.and.screwdriver" onPress={detail('developer')} /></SettingsGroup>}
  </ScrollView>;
}

function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return <View style={{ gap: 8 }}><ThemedText variant="section" accessibilityRole="header">{title}</ThemedText>
    <View style={{ paddingHorizontal: 12, backgroundColor: Gallery.surface, borderRadius: 12, borderWidth: 0.5, borderColor: Gallery.separator, overflow: 'hidden' }}>
      {Children.toArray(children).map((row, index) => <Fragment key={index}>{index > 0 && <View style={{ height: 0.5, backgroundColor: Gallery.separator }} />}{row}</Fragment>)}
    </View>
  </View>;
}

function SettingsRow({ label, icon, onPress }: { label: string; icon: ComponentProps<typeof Icon>['name']; onPress: () => void }) {
  return <Host matchContents={{ vertical: true }} colorScheme="light" style={{ width: '100%' }}>
    <Button variant="text" onPress={onPress} modifiers={[accessibilityLabel(label), frame({ maxWidth: Infinity })]}>
      <Row spacing={16} alignment="center" modifiers={[frame({ maxWidth: Infinity, minHeight: 54 }), contentShape(shapes.rectangle())]}>
        <Icon name={icon} size={22} color={Gallery.ink} />
        <NativeText textStyle={{ color: Gallery.ink }} modifiers={[font({ textStyle: 'body' }), frame({ maxWidth: Infinity, alignment: 'leading' })]}>{label}</NativeText>
        <Icon name="chevron.right" size={13} color={Gallery.muted} />
      </Row>
    </Button>
  </Host>;
}
