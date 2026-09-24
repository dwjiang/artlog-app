import { LIMITS } from "../journal/limits";

export function isUsername(value: string): boolean {
  return (
    value.length >= LIMITS.usernameMin && value.length <= LIMITS.usernameMax && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
  );
}

/** Usernames derived from a display name, in the order they should be offered. */
export function usernameCandidates(name: string, count = 20): string[] {
  const suffixRoom = 1 + String(count).length;
  const base = name
    .normalize("NFKD")
    .replaceAll(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, LIMITS.usernameMax - suffixRoom)
    .replace(/-+$/, "");
  if (!base) return [];
  return [base, ...Array.from({ length: count - 1 }, (_, index) => `${base}-${index + 2}`)].filter(isUsername);
}
