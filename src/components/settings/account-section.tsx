import { Switch } from "@expo/ui";
import { router } from "expo-router";
import { useState } from "react";
import { Alert } from "react-native";

import {
  GroupedButtons,
  GroupedFooter,
  GroupedSection,
  ListButton,
  NavigationRow,
  ValueRow,
} from "@/components/grouped-list";
import { signInRoute } from "@/lib/account/sign-in-context";
import { useAccount } from "@/lib/account/use-account";
import { SAFETY_CHECKS_FOOTER, useSafetyChecks } from "@/lib/social/safety-checks";
import { useSocialSession } from "@/lib/social/use-social-session";

export function AccountSection() {
  const { account, busy, error, signOut, deleteAccount } = useAccount();
  const [operation, setOperation] = useState<"sign-out" | "delete">();
  async function disconnect(remove: boolean) {
    setOperation(remove ? "delete" : "sign-out");
    try {
      await (remove ? deleteAccount() : signOut());
    } finally {
      setOperation(undefined);
    }
  }
  const confirmDelete = (title: string, message: string, action: string) =>
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel" },
      {
        text: action,
        style: "destructive",
        onPress: () => {
          void disconnect(true);
        },
      },
    ]);
  const session = useSocialSession();
  const checks = useSafetyChecks({ safetyChecks: account?.safetyChecks === true });
  const profileRequired = session.status === "profile-required";
  const status = error ? <GroupedFooter tone="destructive">{error}</GroupedFooter> : undefined;
  if (!account?.linked) {
    return (
      <>
        <GroupedButtons
          footer={status}
          textActions={
            (account || operation === "delete") && (
              <ListButton
                label="Delete my data"
                variant="text"
                busy={operation === "delete"}
                destructive
                disabled={busy}
                onPress={() =>
                  confirmDelete(
                    "Delete your data?",
                    "Your collection, visits and photos will be erased from this iPhone and from Artlog. This can’t be undone.",
                    "Delete",
                  )
                }
              />
            )
          }
        >
          <ListButton
            label="Sign in"
            variant="filled"
            // Offline, the account query never resolves; offer sign-in instead of an endless indicator.
            busy={(account === undefined && !session.offline) || (busy && operation !== "delete")}
            disabled={busy}
            onPress={() => router.push(signInRoute("account"))}
          />
        </GroupedButtons>
      </>
    );
  }
  const appleConfirmation =
    account.provider === "apple"
      ? " Apple will then ask you to confirm, so Artlog stops using your Apple Account."
      : "";
  return (
    <>
      {account.email && (
        <GroupedSection>
          <ValueRow label="Email" value={account.email} />
        </GroupedSection>
      )}
      <GroupedSection footer={status}>
        <NavigationRow
          label={profileRequired ? "Create Profile" : "Edit Profile"}
          onPress={() => router.push(profileRequired ? "/create-profile" : "/edit-profile")}
        />
        {session.status === "ready" && (
          <NavigationRow label="Blocked People" onPress={() => router.push("/blocked-people")} />
        )}
      </GroupedSection>
      <GroupedSection footer={<GroupedFooter>{SAFETY_CHECKS_FOOTER}</GroupedFooter>}>
        <Switch
          label="Safety checks"
          value={checks.enabled}
          disabled={busy || checks.busy || session.offline || !session.accountReady}
          onValueChange={(on) => void (on ? checks.turnOn() : checks.turnOff())}
        />
      </GroupedSection>
      <GroupedButtons
        textActions={
          <ListButton
            label="Delete account"
            variant="text"
            busy={operation === "delete"}
            destructive
            disabled={busy}
            onPress={() =>
              confirmDelete(
                "Delete account?",
                `Your profile, posts and collection will be erased from Artlog and this iPhone, and your other devices will be signed out.${appleConfirmation} This can’t be undone.`,
                "Delete account",
              )
            }
          />
        }
      >
        <ListButton
          label="Sign out"
          busy={operation === "sign-out"}
          disabled={busy}
          onPress={() =>
            Alert.alert(
              "Sign out of Artlog?",
              "Your saved artworks remain on this iPhone. Sign in again to share and connect.",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Sign out",
                  style: "destructive",
                  onPress: () => {
                    void disconnect(false);
                  },
                },
              ],
            )
          }
        />
      </GroupedButtons>
    </>
  );
}
