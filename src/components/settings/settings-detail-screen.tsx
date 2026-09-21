import { useConvexAuth, useQuery } from 'convex/react';
import { useNetworkState } from 'expo-network';
import { router, Stack } from 'expo-router';
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
import { ActionRow, GroupedFooter, GroupedList, GroupedSection, ValueRow } from '@/components/grouped-list';
import { SearchConsentSheet } from '@/components/scan/result/search-consent-sheet';
import { LeaderboardParticipation } from '@/components/social/leaderboard-participation';
import { useDeviceReady } from '@/lib/use-device-ready';
import model from '../../../shared/model/model-version.json';

const titles = { account: 'Account', visits: 'Visits', leaderboards: 'Leaderboards', contributions: 'Contributions', export: 'Export journal', privacy: 'Privacy', about: 'About', developer: 'Developer tools' };

export function SettingsDetailScreen({ section }: { section: string }) {
  // Sheets are React Native views, so they mount beside the SwiftUI list rather than inside a section.
  const [sheet, setSheet] = useState<'contributions' | 'consent' | 'participation'>();
  const ready = useDeviceReady();
  const { isAuthenticated } = useConvexAuth();
  const me = useQuery(api.devices.me, section === 'developer' && isAuthenticated ? {} : 'skip');
  const health = useQuery(api.health.ping, section === 'developer' ? {} : 'skip');
  const contributions = useQuery(api.contributions.mine, section === 'contributions' && ready ? {} : 'skip');
  const network = useNetworkState();
  const offline = network.isConnected === false || network.isInternetReachable === false;
  const title = titles[section as keyof typeof titles] ?? 'Settings';
  const close = () => setSheet(undefined);
  return <>
    <Stack.Screen options={{ title }} />
    <GroupedList>
      {(!(section in titles) || (section === 'developer' && !__DEV__)) && <GroupedSection title="Settings unavailable" footer={<GroupedFooter>This settings page is not available.</GroupedFooter>}>
        <ActionRow label="Back to Settings" onPress={() => router.back()} />
      </GroupedSection>}
      {section === 'account' && <AccountSection />}
      {section === 'visits' && <VisitPreference />}
      {section === 'leaderboards' && <LeaderboardPreference onManage={() => setSheet('participation')} />}
      {section === 'contributions' && <SharingSection contributions={contributions} offline={offline} onOpenContributions={() => setSheet('contributions')} />}
      {section === 'export' && <ExportSection />}
      {section === 'privacy' && <PrivacySection onRequestConsent={() => setSheet('consent')} />}
      {section === 'about' && <AboutSection />}
      {section === 'developer' && __DEV__ && <>
        <GroupedSection title="Device"><ValueRow label="Registration" loading={me === undefined} value={me ? `${me.deviceId} · attested: ${me.attested ? 'yes' : 'no'}` : 'Unavailable'} />
          <ValueRow label="Model" value={model.modelVersion} />
          <ValueRow label="Backend" value="Connected" loading={!health} /></GroupedSection>
        <DevTools attested={me?.attested ?? false} />
      </>}
    </GroupedList>
    {section === 'contributions' && <ContributionsSheet open={sheet === 'contributions'} onDismiss={close} contributions={contributions} offline={offline} />}
    {section === 'privacy' && <SearchConsentSheet open={sheet === 'consent'} onGranted={close} onDismiss={close} />}
    {sheet === 'participation' && <LeaderboardParticipation onDismiss={close} />}
  </>;
}
