import { ListItem, Text } from '@expo/ui';
import { font } from '@expo/ui/swift-ui/modifiers';
import { router } from 'expo-router';

import { GroupedFooter, GroupedList, GroupedSection, NavigationRow } from '@/components/grouped-list';
import { Gallery } from '@/constants/theme';
import { signInRoute } from '@/lib/account/sign-in-context';
import { useAccount } from '@/lib/account/use-account';

export function SettingsScreen() {
  const { account } = useAccount();
  const detail = (section: string) => () => router.push({ pathname: '/settings-detail', params: { section } });
  return <GroupedList>
    <GroupedSection title={account?.linked ? undefined : 'Using Artlog without an account'} footer={<GroupedFooter>{account?.linked
      ? 'Saved works and photos sync privately across your devices.' : 'Saved on this iPhone. Sign in to sync across devices or share with friends.'}</GroupedFooter>}>
      <ListItem supportingText={<Text textStyle={{ color: Gallery.muted }} modifiers={[font({ textStyle: 'footnote' })]}>{account?.linked
          ? account.email ?? `${account.deviceCount} linked ${account.deviceCount === 1 ? 'device' : 'devices'}`
          : 'Sync your collection and share visits with friends.'}</Text>}
        onPress={account?.linked ? detail('account') : () => router.push(signInRoute('account'))}>
        {account?.linked ? 'Your Artlog account' : 'Sign in to Artlog'}
      </ListItem>
    </GroupedSection>
    <GroupedSection title="Preferences">
      <NavigationRow label="Visits" onPress={detail('visits')} />
      <NavigationRow label="Leaderboards" onPress={detail('leaderboards')} />
      <NavigationRow label="Public notes" onPress={() => router.push('/public-notes')} />
    </GroupedSection>
    <GroupedSection title="Sharing">
      <NavigationRow label="Contributions" onPress={detail('contributions')} />
    </GroupedSection>
    <GroupedSection title="Your data">
      <NavigationRow label="Export journal" onPress={detail('export')} />
      <NavigationRow label="Privacy" onPress={detail('privacy')} />
      <NavigationRow label="About" onPress={detail('about')} />
    </GroupedSection>
    {__DEV__ && <GroupedSection title="Developer"><NavigationRow label="Developer tools" onPress={detail('developer')} /></GroupedSection>}
  </GroupedList>;
}
