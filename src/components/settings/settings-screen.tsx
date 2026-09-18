import { Icon, ListItem, Text } from '@expo/ui';
import { Section } from '@expo/ui/swift-ui';
import { font } from '@expo/ui/swift-ui/modifiers';
import { router } from 'expo-router';

import { GroupedFooter, GroupedList, NavigationRow } from '@/components/grouped-list';
import { Gallery } from '@/constants/theme';
import { signInRoute } from '@/lib/account/sign-in-context';
import { useAccount } from '@/lib/account/use-account';

export function SettingsScreen() {
  const { account } = useAccount();
  const detail = (section: string) => () => router.push({ pathname: '/settings-detail', params: { section } });
  return <GroupedList>
    <Section title={account?.linked ? undefined : 'Using Artlog without an account'} footer={<GroupedFooter>{account?.linked
      ? 'Saved works and photos sync privately across your devices.' : 'Saved on this iPhone. Sign in to sync across devices or share with friends.'}</GroupedFooter>}>
      <ListItem leading={<Icon name="person.crop.circle" size={38} color={Gallery.muted} />}
        trailing={<Icon name="chevron.right" size={12} color={Gallery.muted} />}
        supportingText={<Text textStyle={{ color: Gallery.muted }} modifiers={[font({ textStyle: 'footnote' })]}>{account?.linked
          ? account.email ?? `${account.deviceCount} linked ${account.deviceCount === 1 ? 'device' : 'devices'}`
          : 'Sync your collection and share visits with friends.'}</Text>}
        onPress={account?.linked ? detail('account') : () => router.push(signInRoute('account'))}>
        {account?.linked ? 'Your Artlog account' : 'Sign in to Artlog'}
      </ListItem>
    </Section>
    <Section title="Preferences">
      <NavigationRow label="Visits" icon="building.columns.fill" onPress={detail('visits')} />
      <NavigationRow label="Leaderboards" icon="trophy.fill" onPress={detail('leaderboards')} />
      <NavigationRow label="Public notes" icon="note.text" onPress={() => router.push('/public-notes')} />
    </Section>
    <Section title="Sharing">
      <NavigationRow label="Contributions" icon="person.crop.square.fill" onPress={detail('contributions')} />
    </Section>
    <Section title="Your data">
      <NavigationRow label="Export journal" icon="square.and.arrow.up" onPress={detail('export')} />
      <NavigationRow label="Privacy" icon="hand.raised.fill" onPress={detail('privacy')} />
      <NavigationRow label="About Artlog" icon="info.circle.fill" onPress={detail('about')} />
    </Section>
    {__DEV__ && <Section title="Developer"><NavigationRow label="Developer tools" icon="wrench.and.screwdriver.fill" onPress={detail('developer')} /></Section>}
  </GroupedList>;
}
