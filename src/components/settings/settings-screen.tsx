import { useConvexAuth, useQuery } from 'convex/react';
import { useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { api } from '../../../convex/_generated/api';
import { AboutSection } from './about-section';
import { AccountSection } from './account-section';
import { DevTools } from './dev-tools';
import { ExportSection } from './export-section';
import { PrivacySection } from './privacy-section';
import { SettingsIdentity } from './settings-identity';
import { ContributionsSheet, SharingSection } from './sharing-section';
import { VisitPreference } from './visit-preference';
import { ThemedText } from '@/components/themed-text';
import { Gallery } from '@/constants/theme';
import { useDeviceReady } from '@/lib/use-device-ready';

export function SettingsScreen() {
  const { isAuthenticated } = useConvexAuth();
  const me = useQuery(api.devices.me, isAuthenticated ? {} : 'skip');
  const ready = useDeviceReady();
  const contributions = useQuery(api.contributions.mine, ready ? {} : 'skip');
  const [contributionsOpen, setContributionsOpen] = useState(false);

  return <><ScrollView style={styles.page} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
    <SettingsIdentity />
    <SettingsGroup title="Account"><AccountSection /></SettingsGroup>
    <SettingsGroup title="Preferences"><VisitPreference /></SettingsGroup>
    <SettingsGroup title="Privacy"><PrivacySection /></SettingsGroup>
    <SettingsGroup title="Sharing"><SharingSection contributions={contributions} onOpenContributions={() => setContributionsOpen(true)} /></SettingsGroup>
    <SettingsGroup title="Export"><ExportSection /></SettingsGroup>
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
  return <View style={styles.group}>
    <Text accessibilityRole="header" style={styles.eyebrow}>{title}</Text>
    <View style={styles.groupBody}>{children}</View>
  </View>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: Gallery.paper },
  content: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 40, gap: 26 },
  group: { gap: 8 },
  eyebrow: { fontSize: 10, lineHeight: 16, fontWeight: '500', letterSpacing: 1.1, textTransform: 'uppercase', color: Gallery.muted },
  groupBody: { gap: 14, paddingTop: 13, borderTopWidth: StyleSheet.hairlineWidth, borderColor: Gallery.separator },
});
