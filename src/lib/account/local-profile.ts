import { useEffect, useState } from "react";

import { getSetting, setSetting } from "@/db/repos/settings";
import { reportError } from "@/lib/observability";
import { LIMITS } from "@/shared/journal/limits";

const NAME_KEY = "local-profile-name";
const listeners = new Set<(name: string) => void>();

export async function getLocalProfileName(): Promise<string | undefined> {
  return (await getSetting(NAME_KEY))?.trim() || undefined;
}

export async function setLocalProfileName(value: string): Promise<void> {
  const name = value.trim();
  if (!name || name.length > LIMITS.name) throw new Error("Enter a name between 1 and 60 characters.");
  // This is an installation preference, so changing the active journal owner cannot clear it.
  await setSetting(NAME_KEY, name);
  for (const listener of listeners) listener(name);
}

export function useLocalProfileName() {
  const [state, setState] = useState<{ name?: string; loading: boolean }>({ loading: true });
  useEffect(() => {
    let reading = true;
    const changed = (name: string) => {
      reading = false;
      setState({ name, loading: false });
    };
    listeners.add(changed);
    void getLocalProfileName().then(
      (name) => {
        if (reading) setState({ name, loading: false });
      },
      (cause: unknown) => {
        reportError(cause, "account.local_profile.load");
        if (reading) setState({ loading: false });
      },
    );
    return () => {
      reading = false;
      listeners.delete(changed);
    };
  }, []);
  return state;
}
