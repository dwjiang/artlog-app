import { router } from 'expo-router';
import { Alert } from 'react-native';

import { ActionRow, GroupedFooter, GroupedSection, NavigationRow, ValueRow } from '@/components/grouped-list';
import { signInRoute } from '@/lib/account/sign-in-context';
import { useAccount } from '@/lib/account/use-account';
import { useSocialSession } from '@/lib/social/use-social-session';

export function AccountSection() {
  const { account, busy, error, signOut, deleteAccount } = useAccount();
  const profileRequired = useSocialSession().status === 'profile-required';
  const status = busy ? <GroupedFooter>Updating account…</GroupedFooter> : error ? <GroupedFooter tone="destructive">{error}</GroupedFooter> : undefined;
  if (!account?.linked) return <GroupedSection footer={status}>
    <ActionRow label="Sign in to Artlog" icon="person.crop.circle" onPress={() => router.push(signInRoute('account'))} />
  </GroupedSection>;
  return <>
    {account.email && <GroupedSection footer={<GroupedFooter>Your account is connected with Apple.</GroupedFooter>}><ValueRow label="Apple ID" value={account.email} /></GroupedSection>}
    <GroupedSection footer={status}>
      <NavigationRow label={profileRequired ? 'Create profile' : 'Edit profile'} onPress={() => router.push(profileRequired ? '/create-profile' : '/edit-profile')} />
    </GroupedSection>
    <GroupedSection>
      <ActionRow label="Sign out" icon="rectangle.portrait.and.arrow.right" disabled={busy} onPress={() => Alert.alert('Sign out of Artlog?', 'Your saved artworks remain on this iPhone. Sign in again to share and connect.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Sign out', style: 'destructive', onPress: () => { void signOut(); } }])} />
    </GroupedSection>
    <GroupedSection>
      <ActionRow label="Delete account" icon="trash" destructive disabled={busy} onPress={() => Alert.alert(
        'Delete account?', 'This disconnects all your devices. Saved works stay on each phone.',
        [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete account', style: 'destructive', onPress: () => { void deleteAccount(); } }],
      )} />
    </GroupedSection>
  </>;
}
