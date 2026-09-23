import countryCodes from "./countries.json";

export const LIMITS = {
  page: 20,
  maxPage: 50,
  batchRecords: 50,
  batchBytes: 512 * 1024,
  cursorBytes: 8 * 1024,
  note: 20_000,
  snapshot: 10_000,
  name: 60,
  bio: 160,
  usernameMin: 3,
  usernameMax: 30,
  searchMin: 2,
  searchMax: 100,
  wallItems: 100,
  selectedSaves: 50,
  friends: 200,
  city: 120,
  reportReason: 120,
  reportDetails: 2000,
} as const;

export function utf8Bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
export const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export const isRevision = (value: number) => Number.isSafeInteger(value) && value >= 0;
export const isTimestamp = (value: number) =>
  Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000;
export function isTimeZone(value: string): boolean {
  try {
    return (
      value.length <= 100 &&
      !!new Intl.DateTimeFormat("en", { timeZone: value }).resolvedOptions().timeZone
    );
  } catch {
    return false;
  }
}
export function calendarDate(timestamp: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(timestamp);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}
export function normalizeSearch(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().trim().replace(/\s+/g, " ");
}
// ISO 3166-1 assigned alpha-2 codes plus XK, the user-assigned code MapKit and Wikidata emit for Kosovo.
// The seed pipeline reads the same file, so codes it cannot send never reach `invalid_venue`.
const countries = new Set<string>(countryCodes);
export const isCountry = (value: string) => countries.has(value);
