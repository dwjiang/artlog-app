import { LIMITS } from "../journal/limits";
import { isAllowedIdentity } from "./offensive-text";

export function isUsername(value: string): boolean {
  return value.length >= LIMITS.usernameMin && value.length <= LIMITS.usernameMax && /^[a-z0-9_]+$/.test(value);
}

/** Usernames derived from a display name, in the order they should be offered. */
export function usernameCandidates(name: string, count = 20): string[] {
  const suffixRoom = 1 + String(count).length;
  const base = name
    .normalize("NFKD")
    .replaceAll(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "_")
    .replace(/^_+/, "")
    .slice(0, LIMITS.usernameMax - suffixRoom)
    .replace(/_+$/, "");
  if (!base) return [];
  return [base, ...Array.from({ length: count - 1 }, (_, index) => `${base}_${index + 2}`)].filter(
    (username) => isUsername(username) && isAllowedIdentity(username),
  );
}
