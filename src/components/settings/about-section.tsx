import { Section } from '@expo/ui/swift-ui';
import { useQuery } from 'convex/react';
import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import { useState } from 'react';

import { api } from '../../../convex/_generated/api';
import model from '../../../shared/model/model-version.json';
import { ActionRow, GroupedFooter, ValueRow } from '@/components/grouped-list';

const SOURCE_URL = 'https://github.com/dwjiang/artlog-app';

export function AboutSection() {
  const health = useQuery(api.health.ping);
  const [error, setError] = useState<string>();
  async function open(url: string) {
    setError(undefined);
    try { await Linking.openURL(url); }
    catch { setError("Couldn't open the link. Try again."); }
  }
  return <>
    <Section>
      <ValueRow label="Version" value={Constants.expoConfig?.version ?? Constants.nativeAppVersion ?? 'Unknown'} />
      <ValueRow label="Model" value={model.modelVersion} />
      <ValueRow label="Backend" value={health ? 'Connected' : 'Connecting…'} />
    </Section>
    <Section footer={error ? <GroupedFooter tone="destructive">{error}</GroupedFooter> : undefined}>
      <ActionRow label="Source code" icon="chevron.left.forwardslash.chevron.right" onPress={() => { void open(SOURCE_URL); }} />
    </Section>
  </>;
}
