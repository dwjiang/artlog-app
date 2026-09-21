import { router } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { ActionRow, GroupedFooter, GroupedSection, NavigationRow, ValueRow } from '@/components/grouped-list';
import { signInRoute } from '@/lib/account/sign-in-context';
import { useAccount } from '@/lib/account/use-account';
import { useSocialSession } from '@/lib/social/use-social-session';

export function AccountSection() {
  const { account, busy, error, signOut, deleteAccount } = useAccount();
  const [operation, setOperation] = useState<'sign-out' | 'delete'>();
  async function disconnect(remove: boolean) {
    setOperation(remove ? 'delete' : 'sign-out');
    try { await (remove ? deleteAccount() : signOut()); }
    finally { setOperation(undefined); }
  }
  const session = useSocialSession();
  const profileRequired = session.status === 'profile-required';
  const status = error ? <GroupedFooter tone="destructive">{error}</GroupedFooter> : undefined;
  // Offline, the account query never resolves; keep the sign-in row instead of an endless indicator.
  if (!account?.linked) return <GroupedSection footer={status}>
    {(account === undefined && !session.offline) || busy ? <ValueRow label="Account" loading />
      : <ActionRow label="Sign in to Artlog" icon="person.crop.circle" onPress={() => router.push(signInRoute('account'))} />}
  </GroupedSection>;
  return <>
    {account.email && <GroupedSection><ValueRow label="Apple ID" value={account.email} /></GroupedSection>}
    <GroupedSection footer={status}>
      <NavigationRow label={profileRequired ? 'Create profile' : 'Edit profile'} onPress={() => router.push(profileRequired ? '/create-profile' : '/edit-profile')} />
      <ActionRow label="Sign out" busy={operation === 'sign-out'} icon="rectangle.portrait.and.arrow.right" disabled={busy} onPress={() => { void disconnect(false); }} />
      <ActionRow label="Delete account" busy={operation === 'delete'} icon="trash" destructive disabled={busy} onPress={() => Alert.alert(
        'Delete account?', 'This disconnects all your devices. Saved works stay on each phone.',
        [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete account', style: 'destructive', onPress: () => { void disconnect(true); } }],
      )} />
    </GroupedSection>
  </>;
}
