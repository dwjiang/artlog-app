import { router } from 'expo-router';
import { Alert } from 'react-native';

import { ActionRow, GroupedFooter, GroupedSection, ValueRow } from '@/components/grouped-list';
import { signInRoute } from '@/lib/account/sign-in-context';
import { useAccount } from '@/lib/account/use-account';

export function AccountSection() {
  const { account, busy, error, signOut, deleteAccount } = useAccount();
  const status = busy ? <GroupedFooter>Updating account…</GroupedFooter> : error ? <GroupedFooter tone="destructive">{error}</GroupedFooter> : undefined;
  if (!account?.linked) return <GroupedSection footer={status}>
    <ActionRow label="Sign in to Artlog" icon="person.crop.circle" onPress={() => router.push(signInRoute('account'))} />
  </GroupedSection>;
  return <>
    {account.email && <GroupedSection><ValueRow label="Apple ID" value={account.email} /></GroupedSection>}
    <GroupedSection footer={status}>
      <ActionRow label="Sign out" disabled={busy} onPress={() => { void signOut(); }} />
      <ActionRow label="Delete account" destructive disabled={busy} onPress={() => Alert.alert(
        'Delete account?', 'This disconnects all your devices. Saved works stay on each phone.',
        [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete account', style: 'destructive', onPress: () => { void deleteAccount(); } }],
      )} />
    </GroupedSection>
  </>;
}
