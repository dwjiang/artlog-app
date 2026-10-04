import { router } from "expo-router";
import { useState } from "react";
import { Alert } from "react-native";

import {
  ActionRow,
  GroupedButtons,
  GroupedFooter,
  GroupedSection,
  NavigationRow,
  OutlinedListButton,
  ValueRow,
} from "@/components/grouped-list";
import { signInRoute } from "@/lib/account/sign-in-context";
import { useAccount } from "@/lib/account/use-account";
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
  const profileRequired = session.status === "profile-required";
  const status = error ? <GroupedFooter tone="destructive">{error}</GroupedFooter> : undefined;
  // Offline, the account query never resolves; keep the sign-in row instead of an endless indicator.
  if (!account?.linked) {
    return (
      <>
        <GroupedSection footer={status}>
          {(account === undefined && !session.offline) || (busy && operation !== "delete") ? (
            <ValueRow label="Account" loading />
          ) : (
            <ActionRow
              label="Sign in to Artlog"
              icon="person.crop.circle"
              disabled={busy}
              onPress={() => router.push(signInRoute("account"))}
            />
          )}
        </GroupedSection>
        {(account || operation === "delete") && (
          <GroupedButtons>
            <OutlinedListButton
              label="Delete my data"
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
          </GroupedButtons>
        )}
      </>
    );
  }
  return (
    <>
      {account.email && (
        <GroupedSection>
          <ValueRow label="Email" value={account.email} />
        </GroupedSection>
      )}
      <GroupedSection footer={status}>
        <NavigationRow
          label={profileRequired ? "Create profile" : "Edit profile"}
          onPress={() => router.push(profileRequired ? "/create-profile" : "/edit-profile")}
        />
        {session.status === "ready" && (
          <NavigationRow label="Blocked people" onPress={() => router.push("/blocked-people")} />
        )}
      </GroupedSection>
      <GroupedButtons>
        <OutlinedListButton
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
        <OutlinedListButton
          label="Delete account"
          busy={operation === "delete"}
          destructive
          disabled={busy}
          onPress={() =>
            confirmDelete(
              "Delete account?",
              "Your profile, posts and collection will be erased from Artlog and this iPhone, and your other devices will be signed out. This can’t be undone.",
              "Delete account",
            )
          }
        />
      </GroupedButtons>
    </>
  );
}
