import { useEffect, useState } from "react";

import { LIMITS } from "@/shared/journal/limits";
import { isAllowedIdentity } from "@/shared/social/offensive-text";
import { isUsername } from "@/shared/social/username";

import { api } from "../../../convex/_generated/api";
import { useSocialQuery } from "./use-social-query";

export type UsernameCheck = "empty" | "invalid" | "not_allowed" | "checking" | "available" | "taken" | "unchecked";

export function useUsernameCheck(username: string, scope: string): UsernameCheck {
  const valid = isUsername(username);
  const allowed = valid && isAllowedIdentity(username);
  const [settled, setSettled] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSettled(username), 300);
    return () => clearTimeout(timer);
  }, [username]);
  const available = useSocialQuery(
    api.profiles.usernameAvailable,
    allowed && username === settled ? { username } : "skip",
    scope,
  );
  if (!username) return "empty";
  if (!valid) return "invalid";
  if (!allowed) return "not_allowed";
  if (username !== settled || available.loading) return "checking";
  if (available.error) return "unchecked";
  return available.data === false ? "taken" : available.data ? "available" : "checking";
}

export const usernameMessages: Record<UsernameCheck, string> = {
  empty: `Use ${LIMITS.usernameMin}–${LIMITS.usernameMax} lowercase letters, numbers or underscores.`,
  invalid: `Use ${LIMITS.usernameMin}–${LIMITS.usernameMax} lowercase letters, numbers or underscores.`,
  not_allowed: "That username isn’t allowed. Try another.",
  checking: "Checking username…",
  available: "Username available",
  taken: "That username is taken. Try another.",
  unchecked: "Couldn’t check. You can still try this username.",
};

export function isUsernameProblem(check: UsernameCheck): boolean {
  return check === "invalid" || check === "not_allowed" || check === "taken";
}
