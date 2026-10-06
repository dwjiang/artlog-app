import { Switch } from "@expo/ui";
import { useState } from "react";
import { Linking } from "react-native";

import { ActionRow, GroupedFooter, GroupedSection, ValueRow } from "@/components/grouped-list";
import { requestNotificationPermission, useNotificationPermission } from "@/lib/notifications/permission";
import {
  setNotificationPreference,
  useNotificationPreferences,
  type NotificationPreference,
} from "@/lib/notifications/preferences";
import { reportError } from "@/lib/observability";
import { showErrorToast } from "@/lib/ui/toast";

const rows: { preference: NotificationPreference; label: string }[] = [
  { preference: "friends", label: "Friend requests" },
  { preference: "reactions", label: "Likes and comments" },
  { preference: "companions", label: "Visits you’re added to" },
  { preference: "visitReminders", label: "Visit reminders" },
];

export function NotificationPreferences() {
  const permission = useNotificationPermission();
  const { preferences, failed } = useNotificationPreferences();
  const [asking, setAsking] = useState(false);

  async function ask() {
    setAsking(true);
    try {
      await requestNotificationPermission();
    } catch (cause) {
      reportError(cause, "notifications.permission.request");
    } finally {
      setAsking(false);
    }
  }

  // The local write lands within a frame or two and the live query flips the switch, so no saving state is shown.
  async function change(preference: NotificationPreference, on: boolean) {
    try {
      await setNotificationPreference(preference, on);
    } catch (cause) {
      reportError(cause, "notifications.preferences.save");
      showErrorToast("Couldn’t save this notification setting.", () => void change(preference, on));
    }
  }

  return (
    <>
      {permission === "undetermined" && (
        <GroupedSection>
          <ActionRow label="Turn on notifications" busy={asking} onPress={() => void ask()} />
        </GroupedSection>
      )}
      {permission === "denied" && (
        <GroupedSection
          footer={<GroupedFooter>Notifications are off for Artlog. Turn them on in the Settings app.</GroupedFooter>}
        >
          <ActionRow label="Open Settings" onPress={() => void Linking.openSettings()} />
        </GroupedSection>
      )}
      <GroupedSection
        title="Notify me about"
        footer={
          <GroupedFooter tone={failed ? "destructive" : "muted"}>
            {failed
              ? "Your notification settings could not load."
              : "A visit reminder comes 3 hours after your last save while a visit is still open."}
          </GroupedFooter>
        }
      >
        {preferences
          ? rows.map(({ preference, label }) => (
              <Switch
                key={preference}
                label={label}
                value={preferences[preference]}
                disabled={permission !== "granted"}
                onValueChange={(on) => {
                  void change(preference, on);
                }}
              />
            ))
          : !failed && <ValueRow label="Notifications" loading />}
      </GroupedSection>
    </>
  );
}
