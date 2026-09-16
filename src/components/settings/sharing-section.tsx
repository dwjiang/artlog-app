import { BottomSheet, Button, Host, ListItem, RNHostView, Switch } from '@expo/ui';
import { useMutation } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import { useRef, useState } from 'react';
import { FlatList, View } from 'react-native';

import { api } from '../../../convex/_generated/api';
import { ThemedText } from '@/components/themed-text';
import { Gallery, Spacing } from '@/constants/theme';
import { setSharingDefault } from '@/lib/settings/sharing';
import { useSharingDefault } from '@/lib/settings/use-sharing-default';

export const SHARING_SETTING = 'Offer to share confirmed labels';
export type Contribution = FunctionReturnType<typeof api.contributions.mine>[number];

export function SharingSection({ contributions, onOpenContributions }: { contributions: Contribution[] | undefined; onOpenContributions: () => void }) {
  const enabled = useSharingDefault();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  async function change(value: boolean) {
    setSaving(true); setError(undefined);
    try { await setSharingDefault(value); }
    catch { setError("Couldn't save your choice. Try again."); }
    finally { setSaving(false); }
  }

  return <View style={{ gap: Spacing.two }}>
    <Host matchContents colorScheme="light" seedColor={Gallery.accent}>
      <Switch label={SHARING_SETTING} value={enabled === true} disabled={enabled === undefined || saving}
        onValueChange={(value) => { void change(value); }} />
    </Host>
    <ThemedText type="small" themeColor="textSecondary">You choose whether to share each work. No account needed.</ThemedText>
    {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
    <Host matchContents colorScheme="light" seedColor={Gallery.accent}>
      <ListItem onPress={onOpenContributions}>{`My contributions (${contributions?.length ?? '…'})`}</ListItem>
    </Host>
  </View>;
}

export function ContributionsSheet({ open, onDismiss, contributions }: { open: boolean; onDismiss: () => void; contributions: Contribution[] | undefined }) {
  return <BottomSheet isPresented={open} onDismiss={onDismiss} snapPoints={['half', 'full']}>
    <RNHostView>
      <View style={{ flex: 1, padding: Spacing.three, gap: Spacing.three }}>
        <ThemedText type="subtitle" accessibilityRole="header">My contributions</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">Contributions from this device, newest first. Up to 200 are shown.</ThemedText>
        <FlatList data={contributions ?? []} keyExtractor={(row) => row.contributionId}
          contentContainerStyle={{ gap: Spacing.three }} renderItem={({ item }) => <ContributionRow contribution={item} />}
          ListEmptyComponent={<ThemedText>{contributions === undefined ? 'Connecting…' : 'No contributions yet.'}</ThemedText>} />
        <Host matchContents colorScheme="light" seedColor={Gallery.accent}><Button label="Done" onPress={onDismiss} /></Host>
      </View>
    </RNHostView>
  </BottomSheet>;
}

function ContributionRow({ contribution }: { contribution: Contribution }) {
  const withdraw = useMutation(api.contributions.withdraw);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState<string>();
  const [withdrawn, setWithdrawn] = useState(false);
  const removed = withdrawn || contribution.rejectedReason === 'withdrawn';
  const status = removed ? 'Withdrawn' : {
    private: 'Awaiting verification', pending: 'Pending review', promoted: 'In the shared index', rejected: 'Not added to the index',
  }[contribution.status];

  async function remove() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(undefined);
    try {
      await withdraw({ contributionId: contribution.contributionId });
      setWithdrawn(true);
    } catch { setError("Couldn't withdraw this contribution. Check your connection and try again."); }
    finally { inFlight.current = false; setBusy(false); }
  }

  return <View style={{ gap: Spacing.two }}>
    <ThemedText type="smallBold">{contribution.fields.title.value}</ThemedText>
    <ThemedText>{contribution.fields.artist.value}</ThemedText>
    <ThemedText type="small" themeColor="textSecondary">{status}</ThemedText>
    {!removed && <Host matchContents colorScheme="light" seedColor={Gallery.accent}>
      <Button label={busy ? 'Withdrawing…' : 'Withdraw'} disabled={busy} onPress={() => { void remove(); }} />
    </Host>}
    {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
  </View>;
}
