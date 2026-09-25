import { useConvexAuth, useQuery } from "convex/react";
import { router, Stack } from "expo-router";
import { useState } from "react";

import { ActionRow, GroupedFooter, GroupedList, GroupedSection, ValueRow } from "@/components/grouped-list";
import { LeaderboardParticipation } from "@/components/social/leaderboard-participation";
import model from "@/shared/model/model-version.json";

import { api } from "../../../convex/_generated/api";
import { AboutSection } from "./about-section";
import { AccountSection } from "./account-section";
import { DevTools } from "./dev-tools";
import { GeneralPreference } from "./general-preference";
import { LeaderboardPreference } from "./leaderboard-preference";
import { PhotoLibraryPreference } from "./photo-library-preference";
import { PrivacySection } from "./privacy-section";

const titles = {
  account: "Account",
  general: "General",
  leaderboards: "Leaderboards",
  privacy: "Privacy",
  about: "About",
  developer: "Developer tools",
};

export function SettingsDetailScreen({ section }: { section: string }) {
  // Sheets are React Native views, so they mount beside the SwiftUI list rather than inside a section.
  const [participation, setParticipation] = useState(false);
  const { isAuthenticated } = useConvexAuth();
  const me = useQuery(api.devices.me, section === "developer" && isAuthenticated ? {} : "skip");
  const health = useQuery(api.health.ping, section === "developer" ? {} : "skip");
  const title = titles[section as keyof typeof titles] ?? "Settings";
  if (section === "privacy") {
    return (
      <>
        <Stack.Screen options={{ title }} />
        <PrivacySection />
      </>
    );
  }
  if (section === "about") {
    return (
      <>
        <Stack.Screen options={{ title }} />
        <AboutSection />
      </>
    );
  }
  return (
    <>
      <Stack.Screen options={{ title }} />
      <GroupedList>
        {(!(section in titles) || (section === "developer" && !__DEV__)) && (
          <GroupedSection
            title="Settings unavailable"
            footer={<GroupedFooter>This settings page is not available.</GroupedFooter>}
          >
            <ActionRow label="Back to Settings" onPress={() => router.back()} />
          </GroupedSection>
        )}
        {section === "account" && <AccountSection />}
        {section === "general" && (
          <>
            <GeneralPreference />
            <PhotoLibraryPreference />
          </>
        )}
        {section === "leaderboards" && <LeaderboardPreference onManage={() => setParticipation(true)} />}
        {section === "developer" && __DEV__ && (
          <>
            <GroupedSection title="Device">
              <ValueRow
                label="Registration"
                loading={me === undefined}
                value={me ? `${me.deviceId} · attested: ${me.attested ? "yes" : "no"}` : "Unavailable"}
              />
              <ValueRow label="Model" value={model.modelVersion} />
              <ValueRow label="Backend" value="Connected" loading={!health} />
            </GroupedSection>
            <DevTools attested={me?.attested ?? false} />
          </>
        )}
      </GroupedList>
      {participation && <LeaderboardParticipation onDismiss={() => setParticipation(false)} />}
    </>
  );
}
