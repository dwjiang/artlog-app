import type { Exhibition, ExploreFriend } from "./types";

export type ExhibitionTiming = "ending" | "opened" | "upcoming";

export const TIMING_OPTIONS: { value: ExhibitionTiming; label: string }[] = [
  { value: "ending", label: "Ending soon" },
  { value: "opened", label: "Just opened" },
  { value: "upcoming", label: "Opening soon" },
];

export const NO_EXHIBITIONS: Record<ExhibitionTiming, string> = {
  ending: "No exhibitions close in the next 30 days.",
  opened: "No exhibitions opened in the last 30 days.",
  upcoming: "No upcoming exhibitions listed.",
};

export const timingLabel = (timing: ExhibitionTiming) =>
  TIMING_OPTIONS.find((option) => option.value === timing)!.label;

export const isTiming = (value: unknown): value is ExhibitionTiming =>
  TIMING_OPTIONS.some((option) => option.value === value);

export type ExhibitionStatus = { tone: "warning" | "accent" | "muted"; label: string };

/** Lists and countdowns both look back or ahead this far. */
const WINDOW_DAYS = 30;
const JUST_OPENED_DAYS = 14;

const DAY = 86_400_000;
const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY);

/** "Oct 17" from a calendar date, without a time zone shifting the day. */
export function shortDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(Date.parse(date));
}

export function isUpcoming(exhibition: Exhibition, today: string): boolean {
  return exhibition.startsOn !== undefined && exhibition.startsOn > today;
}

export function isRunning(exhibition: Exhibition, today: string): boolean {
  return !isUpcoming(exhibition, today) && today <= exhibition.endsOn;
}

/** "Oct 1 – Dec 11, 2026", or "Through Dec 11, 2026" for a show listed only with its closing date. */
export function exhibitionDates(exhibition: Exhibition): string {
  const year = exhibition.endsOn.slice(0, 4);
  return exhibition.startsOn
    ? `${shortDate(exhibition.startsOn)} – ${shortDate(exhibition.endsOn)}, ${year}`
    : `Through ${shortDate(exhibition.endsOn)}, ${year}`;
}

export function exhibitionStatus(exhibition: Exhibition, today: string): ExhibitionStatus {
  const { startsOn } = exhibition;
  if (startsOn && startsOn > today) {
    return { tone: "accent", label: days(today, startsOn) === 1 ? "Opens tomorrow" : `Opens ${shortDate(startsOn)}` };
  }
  const left = days(today, exhibition.endsOn);
  if (left <= WINDOW_DAYS) {
    const label =
      left === 0
        ? "Ends today"
        : left === 1
          ? "Ends tomorrow"
          : left < 14
            ? `Ends in ${left} days`
            : `Ends in ${Math.floor(left / 7)} weeks`;
    return { tone: "warning", label };
  }
  if (startsOn && days(startsOn, today) <= JUST_OPENED_DAYS) return { tone: "muted", label: "Just opened" };
  return { tone: "muted", label: `Until ${shortDate(exhibition.endsOn)}` };
}

export function exhibitionsByTiming(exhibitions: Exhibition[], timing: ExhibitionTiming, today: string): Exhibition[] {
  if (timing === "upcoming") {
    return exhibitions.filter((exhibition) => isUpcoming(exhibition, today)).sort(byStart);
  }
  const running = exhibitions.filter((exhibition) => isRunning(exhibition, today));
  return timing === "ending"
    ? running.filter((exhibition) => days(today, exhibition.endsOn) <= WINDOW_DAYS).sort(byEnd)
    : running
        .filter((exhibition) => exhibition.startsOn && days(exhibition.startsOn, today) <= WINDOW_DAYS)
        .sort((a, b) => byStart(b, a));
}

// Only lists of shows with opening dates sort by them.
const byStart = (a: Exhibition, b: Exhibition) => a.startsOn!.localeCompare(b.startsOn!);
const byEnd = (a: Exhibition, b: Exhibition) => a.endsOn.localeCompare(b.endsOn);

/** "Maya", "Maya and Sam", "Maya, Priya and Sam", then "Maya, Jonah and 2 others". */
export function friendNames(friends: ExploreFriend[]): string {
  const names = friends.map((friend) => friend.name);
  if (names.length <= 1) return names.join("");
  if (names.length <= 3) return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} others`;
}
