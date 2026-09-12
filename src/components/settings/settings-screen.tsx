import { useConvexAuth, useQuery } from 'convex/react';
import { useState, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';

import { api } from '../../../convex/_generated/api';
import { AboutSection } from './about-section';
import { AccountSection } from './account-section';
import { DevTools } from './dev-tools';
import { ExportSection } from './export-section';
import { PrivacySection } from './privacy-section';
import { ContributionsSheet, SharingSection } from './sharing-section';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Spacing } from '@/constants/theme';
import { useDeviceReady } from '@/lib/use-device-ready';

export function SettingsScreen() {
  const { isAuthenticated } = useConvexAuth();
  const me = useQuery(api.devices.me, isAuthenticated ? {} : 'skip');
  const ready = useDeviceReady();
  const contributions = useQuery(api.contributions.mine, ready ? {} : 'skip');
  const [contributionsOpen, setContributionsOpen] = useState(false);

  return <><ScrollView style={{ flex: 1, backgroundColor: Colors.light.backgroundElement }}
    contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: Spacing.three, gap: Spacing.four }}>
    <SettingsGroup title="Sharing"><SharingSection contributions={contributions} onOpenContributions={() => setContributionsOpen(true)} /></SettingsGroup>
    <SettingsGroup title="Account"><AccountSection /></SettingsGroup>
    <SettingsGroup title="Export"><ExportSection /></SettingsGroup>
    <SettingsGroup title="Privacy"><PrivacySection /></SettingsGroup>
    <SettingsGroup title="About"><AboutSection /></SettingsGroup>
    {__DEV__ && <SettingsGroup title="Developer">
      <ThemedText type="small" themeColor="textSecondary">
        {me ? `Device: ${me.deviceId} · attested: ${me.attested ? 'yes' : 'no'}` : 'Device: registering…'}
      </ThemedText>
      <DevTools attested={me?.attested ?? false} />
    </SettingsGroup>}
  </ScrollView>
    <ContributionsSheet open={contributionsOpen} onDismiss={() => setContributionsOpen(false)} contributions={contributions} />
  </>;
}

function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return <View style={{ gap: Spacing.two }}>
    <ThemedText type="smallBold" themeColor="textSecondary" accessibilityRole="header" style={{ paddingHorizontal: Spacing.three }}>{title}</ThemedText>
    <ThemedView style={{ gap: Spacing.two, padding: Spacing.three, borderRadius: Spacing.three, borderCurve: 'continuous' }}>{children}</ThemedView>
  </View>;
}
