import { Text } from '@expo/ui';
import { Section } from '@expo/ui/swift-ui';
import { useConvexAuth, useQuery } from 'convex/react';
import { Stack } from 'expo-router';
import { useState } from 'react';

import { api } from '../../../convex/_generated/api';
import { AboutSection } from './about-section';
import { AccountSection } from './account-section';
import { DevTools } from './dev-tools';
import { ExportSection } from './export-section';
import { LeaderboardPreference } from './leaderboard-preference';
import { PrivacySection } from './privacy-section';
import { ContributionsSheet, SharingSection } from './sharing-section';
import { VisitPreference } from './visit-preference';
import { GroupedList } from '@/components/grouped-list';
import { SearchConsentSheet } from '@/components/scan/result/search-consent-sheet';
import { LeaderboardParticipation } from '@/components/social/leaderboard-participation';
import { Gallery } from '@/constants/theme';
import { useDeviceReady } from '@/lib/use-device-ready';

const titles = { account: 'Account', visits: 'Visits', leaderboards: 'Leaderboards', contributions: 'Contributions', export: 'Export journal', privacy: 'Privacy', about: 'About Artlog', developer: 'Developer tools' };

export function SettingsDetailScreen({ section }: { section: string }) {
  // Sheets are React Native views, so they mount beside the SwiftUI list rather than inside a section.
  const [sheet, setSheet] = useState<'contributions' | 'consent' | 'participation'>();
  const ready = useDeviceReady();
  const { isAuthenticated } = useConvexAuth();
  const me = useQuery(api.devices.me, section === 'developer' && isAuthenticated ? {} : 'skip');
  const contributions = useQuery(api.contributions.mine, section === 'contributions' && ready ? {} : 'skip');
  const title = titles[section as keyof typeof titles] ?? 'Settings';
  const close = () => setSheet(undefined);
  return <>
    <Stack.Screen options={{ title }} />
    <GroupedList>
      {section === 'account' && <AccountSection />}
      {section === 'visits' && <VisitPreference />}
      {section === 'leaderboards' && <LeaderboardPreference onManage={() => setSheet('participation')} />}
      {section === 'contributions' && <SharingSection contributions={contributions} onOpenContributions={() => setSheet('contributions')} />}
      {section === 'export' && <ExportSection />}
      {section === 'privacy' && <PrivacySection onRequestConsent={() => setSheet('consent')} />}
      {section === 'about' && <AboutSection />}
      {section === 'developer' && __DEV__ && <>
        <Section title="Device"><Text textStyle={{ fontSize: 13, color: Gallery.muted }}>{me ? `${me.deviceId} · attested: ${me.attested ? 'yes' : 'no'}` : 'Registering…'}</Text></Section>
        <DevTools attested={me?.attested ?? false} />
      </>}
    </GroupedList>
    {section === 'contributions' && <ContributionsSheet open={sheet === 'contributions'} onDismiss={close} contributions={contributions} />}
    {section === 'privacy' && <SearchConsentSheet open={sheet === 'consent'} onGranted={close} onDismiss={close} />}
    {sheet === 'participation' && <LeaderboardParticipation onDismiss={close} />}
  </>;
}
