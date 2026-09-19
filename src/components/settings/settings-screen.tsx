import { Button, Host, Icon, Row, Text as NativeText } from '@expo/ui';
import { accessibilityLabel, font, frame } from '@expo/ui/swift-ui/modifiers';
import type { ComponentProps, ReactNode } from 'react';
import Constants from 'expo-constants';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';

import { Gallery } from '@/constants/theme';
import { signInRoute } from '@/lib/account/sign-in-context';
import { useAccount } from '@/lib/account/use-account';
import { api } from '../../../convex/_generated/api';
import { useSocialSession } from '@/lib/social/use-social-session';
import { useSocialQuery } from '@/lib/social/use-social-query';
import { ProfileAvatar } from '../social/profile-avatar';
import { ThemedText } from '../themed-text';
import { HighlightHeading } from '../highlight-heading';

export function SettingsScreen() {
  const { account } = useAccount();
  const session = useSocialSession();
  const { data: profile } = useSocialQuery(api.profiles.mine, session.status === 'ready' ? {} : 'skip', session.key);
  const detail = (section: string) => () => router.push({ pathname: '/settings-detail', params: { section } });
  const accountName = account?.linked ? profile?.name ?? 'Your Artlog account' : 'Sign in to Artlog';
  const accountDetail = account?.linked ? profile ? `@${profile.username}` : account.email : undefined;
  return <ScrollView style={{ flex: 1, backgroundColor: Gallery.paper }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 28, gap: 16 }}>
    <ThemedText variant="pageTitle" accessibilityRole="header">Settings</ThemedText>
    <View style={{ gap: 12 }}>
      {!account?.linked && <ThemedText variant="metadata" themeColor="textSecondary">Using Artlog without an account</ThemedText>}
      <Pressable accessibilityRole="button" accessibilityLabel={accountName} accessibilityHint={account?.linked ? 'Manage your Artlog account' : undefined}
        onPress={account?.linked ? detail('account') : () => router.push(signInRoute('account'))}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingBottom: 14, borderBottomWidth: 0.5, borderColor: Gallery.separator }}>
        {profile ? <ProfileAvatar name={profile.name} photoUrl={profile.photoUrl} size={64} />
          : <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: Gallery.avatar, alignItems: 'center', justifyContent: 'center' }}>
            <Image source="sf:person.fill" tintColor={Gallery.ink} style={{ width: 28, height: 28 }} accessible={false} /></View>}
        <View style={{ flex: 1, gap: 4 }}>
          <ThemedText variant="section" style={{ fontSize: 24, lineHeight: 28 }}>{accountName}</ThemedText>
          {!!accountDetail && <ThemedText variant="metadata" themeColor="textSecondary">{accountDetail}</ThemedText>}
        </View>
        <ThemedText themeColor="textSecondary" accessible={false}>›</ThemedText>
      </Pressable>
    </View>
    <SettingsGroup title="Your journal">
      <SettingsRow label="Visits" icon="chart.bar" onPress={detail('visits')} />
      <SettingsRow label="Leaderboards" icon="trophy" onPress={detail('leaderboards')} />
      <SettingsRow label="Public notes" icon="text.bubble" onPress={() => router.push('/public-notes')} />
      <SettingsRow label="Contributions" icon="person.2" onPress={detail('contributions')} />
    </SettingsGroup>
    <SettingsGroup title="Your data">
      <SettingsRow label="Export journal" icon="square.and.arrow.down" onPress={detail('export')} />
      <SettingsRow label="Privacy" icon="lock" onPress={detail('privacy')} />
      <SettingsRow label="About" icon="info.circle" onPress={detail('about')} />
    </SettingsGroup>
    <ThemedText variant="metadata" themeColor="textSecondary">Artlog · Version {Constants.expoConfig?.version ?? Constants.nativeAppVersion ?? 'Unknown'}</ThemedText>
    {__DEV__ && <SettingsGroup title="Developer"><SettingsRow label="Developer tools" icon="wrench.and.screwdriver" onPress={detail('developer')} /></SettingsGroup>}
  </ScrollView>;
}

function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return <View style={{ gap: 8 }}><HighlightHeading small>{title}</HighlightHeading>{children}</View>;
}

function SettingsRow({ label, icon, onPress }: { label: string; icon: ComponentProps<typeof Icon>['name']; onPress: () => void }) {
  return <View style={{ borderBottomWidth: 0.5, borderColor: Gallery.separator }}>
    <Host matchContents={{ vertical: true }} colorScheme="light" style={{ width: '100%' }}>
      <Button variant="text" onPress={onPress} modifiers={[accessibilityLabel(label), frame({ maxWidth: Infinity })]}>
        <Row spacing={16} alignment="center" modifiers={[frame({ maxWidth: Infinity, minHeight: 54 })]}>
          <Icon name={icon} size={22} color={Gallery.ink} />
          <NativeText textStyle={{ color: Gallery.ink }} modifiers={[font({ textStyle: 'body' }), frame({ maxWidth: Infinity, alignment: 'leading' })]}>{label}</NativeText>
          <Icon name="chevron.right" size={13} color={Gallery.muted} />
        </Row>
      </Button>
    </Host>
  </View>;
}
