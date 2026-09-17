import { useConvexAuth, useQuery } from 'convex/react';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { api } from '../../../convex/_generated/api';
import { AboutSection } from './about-section';
import { AccountSection } from './account-section';
import { DevTools } from './dev-tools';
import { ExportSection } from './export-section';
import { LeaderboardPreference } from './leaderboard-preference';
import { PrivacySection } from './privacy-section';
import { ContributionsSheet, SharingSection } from './sharing-section';
import { VisitPreference } from './visit-preference';
import { ThemedText } from '@/components/themed-text';
import { Gallery, Spacing } from '@/constants/theme';
import { useDeviceReady } from '@/lib/use-device-ready';

const titles = { account: 'Account', visits: 'Visits', leaderboards: 'Leaderboards', contributions: 'Contributions', export: 'Export journal', privacy: 'Privacy', about: 'About Artlog', developer: 'Developer tools' };

export function SettingsDetailScreen({ section }: { section: string }) {
  const [contributionsOpen, setContributionsOpen] = useState(false);
  const ready = useDeviceReady();
  const { isAuthenticated } = useConvexAuth();
  const me = useQuery(api.devices.me, section === 'developer' && isAuthenticated ? {} : 'skip');
  const contributions = useQuery(api.contributions.mine, section === 'contributions' && ready ? {} : 'skip');
  const title = titles[section as keyof typeof titles] ?? 'Settings';
  return <>
    <Stack.Screen options={{ title }} />
    <ScrollView style={{ flex: 1, backgroundColor: Gallery.paper }} contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: Spacing.three }}>
      <View style={{ padding: Spacing.three, gap: Spacing.three, backgroundColor: Gallery.surface, borderRadius: 16, borderCurve: 'continuous' }}>
        {section === 'account' && <AccountSection />}
        {section === 'visits' && <VisitPreference />}
        {section === 'leaderboards' && <LeaderboardPreference />}
        {section === 'contributions' && <SharingSection contributions={contributions} onOpenContributions={() => setContributionsOpen(true)} />}
        {section === 'export' && <ExportSection />}
        {section === 'privacy' && <PrivacySection />}
        {section === 'about' && <AboutSection />}
        {section === 'developer' && __DEV__ && <>
          <ThemedText type="small" themeColor="textSecondary">{me ? `Device: ${me.deviceId} · attested: ${me.attested ? 'yes' : 'no'}` : 'Device: registering…'}</ThemedText>
          <DevTools attested={me?.attested ?? false} />
        </>}
      </View>
    </ScrollView>
    {section === 'contributions' && <ContributionsSheet open={contributionsOpen} onDismiss={() => setContributionsOpen(false)} contributions={contributions} />}
  </>;
}
