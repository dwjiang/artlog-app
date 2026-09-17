import { Host, Icon, ListItem, Text } from '@expo/ui';
import { List, Section } from '@expo/ui/swift-ui';
import { background, foregroundStyle, frame, listStyle, scrollContentBackground } from '@expo/ui/swift-ui/modifiers';
import { router } from 'expo-router';
import type { ComponentProps } from 'react';

import { Gallery } from '@/constants/theme';
import { signInRoute } from '@/lib/account/sign-in-context';
import { useAccount } from '@/lib/account/use-account';

export function SettingsScreen() {
  const { account } = useAccount();
  return <Host style={{ flex: 1 }} colorScheme="light" seedColor={Gallery.accent}>
    <List modifiers={[listStyle('insetGrouped'), scrollContentBackground('hidden'), background(Gallery.paper), foregroundStyle(Gallery.ink)]}>
      <Section footer={<Text textStyle={{ fontSize: 12, color: Gallery.muted }}>{account?.linked
        ? 'Saved works and photos sync privately across your devices.' : 'Saved works and photos stay on this phone when you sign out.'}</Text>}>
        <ListItem leading={<Icon name="person.crop.circle" size={38} color={Gallery.muted} />}
          trailing={<Icon name="chevron.right" size={12} color={Gallery.muted} />}
          supportingText={<Text textStyle={{ fontSize: 13, color: Gallery.muted }}>{account?.linked
            ? account.email ?? `${account.deviceCount} linked ${account.deviceCount === 1 ? 'device' : 'devices'}`
            : 'Sync your collection and share visits with friends.'}</Text>}
          onPress={() => router.push(account?.linked ? { pathname: '/settings-detail', params: { section: 'account' } } : signInRoute('account'))}>
          {account?.linked ? 'Your Artlog account' : 'Sign in to Artlog'}
        </ListItem>
      </Section>
      <Section title="Preferences">
        <SettingsRow label="Visits" icon="building.columns.fill" section="visits" />
        <SettingsRow label="Leaderboards" icon="trophy.fill" section="leaderboards" />
        <SettingsRow label="Public notes" icon="note.text" onPress={() => router.push('/public-notes')} />
      </Section>
      <Section title="Sharing">
        <SettingsRow label="Contributions" icon="person.crop.square.fill" section="contributions" />
      </Section>
      <Section title="Your data">
        <SettingsRow label="Export journal" icon="square.and.arrow.up" section="export" />
        <SettingsRow label="Privacy" icon="hand.raised.fill" section="privacy" />
        <SettingsRow label="About Artlog" icon="info.circle.fill" section="about" />
      </Section>
      {__DEV__ && <Section title="Developer"><SettingsRow label="Developer tools" icon="wrench.and.screwdriver.fill" section="developer" /></Section>}
    </List>
  </Host>;
}

function SettingsRow({ label, icon, section, onPress }: {
  label: string; icon: ComponentProps<typeof Icon>['name']; section?: string; onPress?: () => void;
}) {
  return <ListItem leading={<Icon name={icon} size={22} color={Gallery.accent} modifiers={[frame({ width: 28, height: 28 })]} />}
    trailing={<Icon name="chevron.right" size={12} color={Gallery.muted} />}
    onPress={onPress ?? (() => router.push({ pathname: '/settings-detail', params: { section } }))}>{label}</ListItem>;
}
