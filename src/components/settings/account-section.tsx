import { Section } from '@expo/ui/swift-ui';
import { router } from 'expo-router';
import { Alert } from 'react-native';

import { ActionRow, GroupedFooter, ValueRow } from '@/components/grouped-list';
import { signInRoute } from '@/lib/account/sign-in-context';
import { useAccount } from '@/lib/account/use-account';

export function AccountSection() {
  const { account, busy, error, signOut, deleteAccount } = useAccount();
  const status = busy ? <GroupedFooter>Updating account…</GroupedFooter> : error ? <GroupedFooter tone="destructive">{error}</GroupedFooter> : undefined;
  if (!account?.linked) return <Section footer={status ?? <GroupedFooter>Sync your collection and share visits with friends.</GroupedFooter>}>
    <ActionRow label="Sign in to Artlog" icon="person.crop.circle" onPress={() => router.push(signInRoute('account'))} />
  </Section>;
  return <>
    <Section footer={<GroupedFooter>Saved works and photos sync privately across your devices. Downloaded photos are available offline.</GroupedFooter>}>
      {account.email ? <ValueRow label="Apple ID" value={account.email} /> : null}
      <ValueRow label="Devices" value={`${account.deviceCount} ${account.deviceCount === 1 ? 'device' : 'devices'}`} />
    </Section>
    <Section footer={status}>
      <ActionRow label="Sign out" disabled={busy} onPress={() => { void signOut(); }} />
      <ActionRow label="Delete account" destructive disabled={busy} onPress={() => Alert.alert(
        'Delete account?', 'This disconnects all your devices. Saved works stay on each phone.',
        [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete account', style: 'destructive', onPress: () => { void deleteAccount(); } }],
      )} />
    </Section>
  </>;
}
