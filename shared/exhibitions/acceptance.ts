export type ExhibitionMuseum = {
  museumId: string;
  name: string;
  timeZone: string;
  sourceUrls: string[];
  venueNames?: string[];
  /** ISO 3166 code; numeric dates such as 01.07.2026 read month first only in month-first countries or when unset. */
  country?: string;
};

export type CapturedPage = {
  url: string;
  checkedAt: number;
  text: string;
  sha256: string;
};

export type ExhibitionInterval = {
  startDate: string | null;
  endDate: string | null;
  dateEvidence: string;
};

export type ExhibitionCandidate = {
  title: string;
  url: string;
  startDate: string | null;
  endDate: string | null;
  dateText: string;
  titleEvidence: string;
  venueEvidence: string;
  dateEvidence: string;
  kind: "temporary_exhibition" | "permanent" | "event" | "unknown";
  venueMatch: boolean;
  datePrecision: "day" | "month" | "season" | "unknown";
  intervals?: ExhibitionInterval[];
};

export type AcceptedExhibition = Omit<ExhibitionCandidate, "intervals" | "endDate"> & {
  endDate: string;
  museumId: string;
  timeZone: string;
  checkedAt: number;
  sourceSha256: string;
};

export type RejectedExhibition = {
  candidate: ExhibitionCandidate;
  reasons: string[];
};

// Month names and their usual abbreviations in English, French, German, Italian, Spanish and Dutch, matched on text
// whose accents are removed.
const months = [
  ["january", "jan", "janvier", "janv", "januar", "janner", "gennaio", "gen", "enero", "ene", "januari"],
  ["february", "feb", "fevrier", "fevr", "fev", "februar", "febbraio", "febrero", "februari"],
  ["march", "mar", "mars", "marz", "mrz", "marzo", "maart", "mrt"],
  ["april", "apr", "avril", "avr", "aprile", "abril", "abr"],
  ["may", "mai", "maggio", "mag", "mayo", "mei"],
  ["june", "jun", "juin", "juni", "giugno", "giu", "junio"],
  ["july", "jul", "juillet", "juil", "juli", "luglio", "lug", "julio"],
  ["august", "aug", "aout", "agosto", "ago", "augustus"],
  ["september", "sep", "sept", "septembre", "settembre", "set", "septiembre", "setiembre"],
  ["october", "oct", "octobre", "oktober", "okt", "ottobre", "ott", "octubre"],
  ["november", "nov", "novembre", "noviembre"],
  ["december", "dec", "decembre", "dezember", "dez", "dicembre", "dic", "diciembre"],
];
const monthNumbers = new Map(months.flatMap((names, index) => names.map((name) => [name, index + 1] as const)));
const monthPattern = `(?:${[...monthNumbers.keys()].sort((a, b) => b.length - a.length).join("|")})(?![a-z])\\.?`;
const weekdays = [
  ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"],
  ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
  ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"],
  ["montag", "dienstag", "mittwoch", "donnerstag", "freitag", "samstag", "sonnabend", "sonntag"],
  ["lunedi", "martedi", "mercoledi", "giovedi", "venerdi", "sabato", "domenica"],
  ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"],
  ["maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag"],
].flat();
// Ordinal marks: 1st, 1er, 1º (read as "1o"), 1° and the German "1.".
const dayPattern = "(\\d{1,2})(?:st|nd|rd|th|er|o|°|\\.)?(?!\\d)";
// Spanish puts "de" between day, month and year.
const monthAfterDay = "\\s+(?:de\\s+)?";
const yearPattern = "(?:,?\\s+(?:de\\s+)?(\\d{4})(?!\\d))?";
const rangeWords = [
  "to",
  "through",
  "until",
  "au",
  "jusqu'au",
  "jusqu'a",
  "bis zum",
  "bis",
  "fino al",
  "al",
  "hasta el",
  "hasta",
  "tot en met",
  "tot",
];
const connector = `\\s*(?:-|(?:${rangeWords.join("|")})\\b|t/m(?![\\w/]))\\s*`;
const closingWords = "(?:through|until|jusqu'au|jusqu'a|bis zum|bis|fino al|hasta el|hasta|tot en met|t/m)";
const weekday = `(?:(?:${weekdays.join("|")})\\.?[,]?\\s+)?`;
// A range ends at a word boundary, or right after an explicit year even when a time or another number follows.
const rangeEnd = "(?:(?<=\\d{4})(?!\\d)|\\b(?![\\w/])(?!(?:,\\s*|\\s+)\\d))";

function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replaceAll(/[‘’]/g, "'")
    .replaceAll(/[“”]/g, '"')
    .replaceAll(/[‐‑‒–—−]/g, "-")
    .replaceAll(/\b(\d{3})\s+(\d)\b/g, "$1$2")
    .replaceAll(/\s*-\s*/g, "-")
    .replaceAll(/\s+/g, " ")
    .trim();
}

/** The text dates are read from: normalized, without accents so "février" and "fevrier" read alike. */
function dateText(text: string): string {
  return normalize(text)
    .normalize("NFD")
    .replaceAll(/[\u0300-\u036f]/g, "");
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function calendarDate(year: number, month: number, day: number): string | null {
  const value = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return isCalendarDate(value) ? value : null;
}

function monthNumber(value: string): number {
  return monthNumbers.get(value.replace(".", "")) ?? 0;
}

type NumericOrder = "month-first" | "day-first";

// Countries that write 7/1/2026 for July 1.
const monthFirstCountries = new Set(["US", "PR", "GU", "VI", "AS", "MP", "UM", "PH", "FM", "MH", "PW"]);

function numericDate(value: string, asOfYear: number, order: NumericOrder): string | null {
  if (value.includes("/") || value.includes(".")) {
    if (value.includes("/") && value.includes(".")) return null;
    const [first, second, yearText] = value.split(/[/.]/);
    // A part over 12 can only be the day, whatever the local order.
    const dayFirst = Number(first) > 12 || (order === "day-first" && Number(second) <= 12);
    const [month, day] = dayFirst ? [second, first] : [first, second];
    let year = Number(yearText);
    if (yearText!.length === 2) {
      // Explicit short years resolve to the nearest century; a 50-year tie stays ambiguous.
      year += Math.floor(asOfYear / 100) * 100;
      if (year > asOfYear + 50) year -= 100;
      if (year < asOfYear - 50) year += 100;
      if (Math.abs(year - asOfYear) === 50) return null;
    }
    return calendarDate(year, Number(month), Number(day));
  }
  return isCalendarDate(value) ? value : null;
}

type DateRange = {
  startDate: string | null;
  endDate: string;
  closureSplit?: boolean;
  span?: { start: number; end: number };
};

function literalRanges(evidence: string, asOfYear: number, order: NumericOrder, inferredYear?: number): DateRange[] {
  const text = dateText(evidence);
  const ranges: DateRange[] = [];
  const add = (match: RegExpExecArray, range: DateRange) =>
    ranges.push({ ...range, span: { start: match.index, end: match.index + match[0].length } });
  const addEnglishRange = (
    match: RegExpExecArray,
    startMonth: number,
    startDay: number,
    explicitStartYear: number | undefined,
    endMonth: number,
    endDay: number,
    explicitEndYear: number | undefined,
  ) => {
    if (explicitStartYear === undefined && explicitEndYear === undefined) {
      if (inferredYear === undefined) return;
      explicitStartYear = inferredYear;
      explicitEndYear = inferredYear;
    }
    const crossesYear = endMonth * 100 + endDay < startMonth * 100 + startDay;
    const startYear = explicitStartYear ?? explicitEndYear! - Number(crossesYear);
    const endYear = explicitEndYear ?? explicitStartYear! + Number(crossesYear);
    const startDate = calendarDate(startYear, startMonth, startDay);
    const endDate = calendarDate(endYear, endMonth, endDay);
    if (startDate && endDate && startDate <= endDate) add(match, { startDate, endDate });
  };

  const monthFirst = new RegExp(
    `\\b${weekday}(${monthPattern})\\s+${dayPattern}${yearPattern}${connector}${weekday}(?:(${monthPattern})\\s+)?${dayPattern}${yearPattern}${rangeEnd}`,
    "g",
  );
  for (const match of text.matchAll(monthFirst)) {
    addEnglishRange(
      match,
      monthNumber(match[1]!),
      Number(match[2]),
      match[3] ? Number(match[3]) : undefined,
      monthNumber(match[4] ?? match[1]!),
      Number(match[5]),
      match[6] ? Number(match[6]) : undefined,
    );
  }

  const dayFirst = new RegExp(
    `\\b${weekday}${dayPattern}${monthAfterDay}(${monthPattern})${yearPattern}${connector}${weekday}${dayPattern}${monthAfterDay}(${monthPattern})${yearPattern}${rangeEnd}`,
    "g",
  );
  for (const match of text.matchAll(dayFirst)) {
    addEnglishRange(
      match,
      monthNumber(match[2]!),
      Number(match[1]),
      match[3] ? Number(match[3]) : undefined,
      monthNumber(match[5]!),
      Number(match[4]),
      match[6] ? Number(match[6]) : undefined,
    );
  }

  // "3 au 15 mars 2026", "3.-15. März 2026": both days share the month and year printed after the second.
  const sharedMonth = new RegExp(
    `\\b${weekday}${dayPattern}${connector}${weekday}${dayPattern}${monthAfterDay}(${monthPattern})${yearPattern}${rangeEnd}`,
    "g",
  );
  for (const match of text.matchAll(sharedMonth)) {
    const month = monthNumber(match[3]!);
    const year = match[4] ? Number(match[4]) : undefined;
    addEnglishRange(match, month, Number(match[1]), year, month, Number(match[2]), year);
  }

  const numericPattern = "(?:\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[/.]\\d{1,2}[/.](?:\\d{4}|\\d{2}))";
  const numericRange = new RegExp(
    `\\b${weekday}(${numericPattern})${connector}${weekday}(${numericPattern})\\b(?![\\d/.])`,
    "g",
  );
  for (const match of text.matchAll(numericRange)) {
    const startDate = numericDate(match[1]!, asOfYear, order);
    const endDate = numericDate(match[2]!, asOfYear, order);
    if (startDate && endDate && startDate <= endDate) add(match, { startDate, endDate });
  }

  // Cards that print the opening and closing dates side by side, as "12 mai 2026 08 nov. 2026", with both years.
  if (ranges.length === 0) {
    const fullDate = `${dayPattern}${monthAfterDay}(${monthPattern}),?\\s+(?:de\\s+)?(\\d{4})(?!\\d)`;
    for (const match of text.matchAll(new RegExp(`\\b${fullDate}\\s+${fullDate}`, "g"))) {
      const startDate = calendarDate(Number(match[3]), monthNumber(match[2]!), Number(match[1]));
      const endDate = calendarDate(Number(match[6]), monthNumber(match[5]!), Number(match[4]));
      if (startDate && endDate && startDate <= endDate) add(match, { startDate, endDate });
    }
  }

  const endMonthFirst = new RegExp(`\\b${closingWords}\\s+(${monthPattern})\\s+${dayPattern},?\\s+(\\d{4})\\b`, "g");
  for (const match of text.matchAll(endMonthFirst)) {
    const endDate = calendarDate(Number(match[3]), monthNumber(match[1]!), Number(match[2]));
    if (endDate) add(match, { startDate: null, endDate });
  }
  const endDayFirst = new RegExp(
    `\\b${closingWords}\\s+${dayPattern}${monthAfterDay}(${monthPattern}),?\\s+(?:de\\s+)?(\\d{4})\\b`,
    "g",
  );
  for (const match of text.matchAll(endDayFirst)) {
    const endDate = calendarDate(Number(match[3]), monthNumber(match[2]!), Number(match[1]));
    if (endDate) add(match, { startDate: null, endDate });
  }
  const endNumeric = new RegExp(`\\b${closingWords}\\s+(${numericPattern})\\b(?![\\d/.])`, "g");
  for (const match of text.matchAll(endNumeric)) {
    const endDate = numericDate(match[1]!, asOfYear, order);
    if (endDate) add(match, { startDate: null, endDate });
  }
  const explicitRanges = ranges.filter((range) => range.startDate !== null);
  const distinct = new Map<string, DateRange>();
  for (const range of ranges) {
    if (range.startDate === null && explicitRanges.some((explicit) => explicit.endDate === range.endDate)) continue;
    distinct.set(JSON.stringify([range.startDate, range.endDate]), range);
  }
  return [...distinct.values()];
}

function joinedDateRanges(evidence: string, ranges: DateRange[]): boolean {
  const text = dateText(evidence);
  const spans = ranges.flatMap((range) => (range.span ? [range.span] : [])).sort((a, b) => a.start - b.start);
  // Only date separators may join runs; another title or description makes the association ambiguous.
  return (
    spans.length === ranges.length
    && spans.every((span, index) => {
      if (index === 0) return true;
      const previous = spans[index - 1];
      return previous.end <= span.start && /^[\s,;]*(?:(?:and|&)[\s,;]*)?$/.test(text.slice(previous.end, span.start));
    })
  );
}

function shiftDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function evidenceRanges(evidence: string, asOfYear: number, order: NumericOrder): DateRange[] {
  const text = dateText(evidence);
  const closures = [...text.matchAll(/\b(?:closed|closure)\s*:?\s+(?:from\s+)?([^);]+)(?:[);]|$)/g)];
  if (closures.length === 0) return literalRanges(text, asOfYear, order);
  if (closures.length !== 1) return [];
  const closure = closures[0]!;
  const publishedRanges = literalRanges(text.replace(closure[0], ""), asOfYear, order);
  if (publishedRanges.length !== 1 || publishedRanges[0]!.startDate === null) return [];
  const published = publishedRanges[0]!;
  const startYear = Number(published.startDate!.slice(0, 4));
  const inferredYear = startYear === Number(published.endDate.slice(0, 4)) ? startYear : undefined;
  const closureRanges = literalRanges(closure[1]!, asOfYear, order, inferredYear);
  if (closureRanges.length !== 1 || closureRanges[0]!.startDate === null) return [];
  const closed = closureRanges[0]!;
  if (closed.startDate! < published.startDate! || closed.endDate > published.endDate) return [];
  const runs: DateRange[] = [];
  if (published.startDate! < closed.startDate!) {
    runs.push({ startDate: published.startDate, endDate: shiftDate(closed.startDate!, -1), closureSplit: true });
  }
  if (closed.endDate < published.endDate) {
    runs.push({ startDate: shiftDate(closed.endDate, 1), endDate: published.endDate, closureSplit: true });
  }
  return runs;
}

function officialHost(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.hostname.toLowerCase().replace(/^www\./, "") : null;
  } catch {
    return null;
  }
}

export function validateExhibitions({
  museum,
  pages,
  candidates,
  asOfDate,
}: {
  museum: ExhibitionMuseum;
  pages: CapturedPage[];
  candidates: ExhibitionCandidate[];
  asOfDate: string;
}): { accepted: AcceptedExhibition[]; rejected: RejectedExhibition[] } {
  if (!isCalendarDate(asOfDate)) throw new Error("asOfDate must be a valid museum-local YYYY-MM-DD calendar date");
  const accepted: AcceptedExhibition[] = [];
  const rejected: RejectedExhibition[] = [];
  const seen = new Set<string>();
  const officialHosts = new Set(museum.sourceUrls.map(officialHost).filter((host) => host !== null));
  const asOfYear = Number(asOfDate.slice(0, 4));
  const order: NumericOrder =
    museum.country === undefined || monthFirstCountries.has(museum.country) ? "month-first" : "day-first";

  for (const original of candidates) {
    if (original.intervals?.length === 0) {
      rejected.push({ candidate: original, reasons: ["empty_intervals"] });
      continue;
    }
    const { intervals, ...base } = original;
    const originalRanges = evidenceRanges(original.dateEvidence, asOfYear, order);
    const completeIntervals =
      !intervals
      || (originalRanges.length === intervals.length
        && originalRanges.every((range) =>
          intervals.some((interval) => interval.startDate === range.startDate && interval.endDate === range.endDate),
        ));
    const runs = intervals ? intervals.map((interval) => ({ ...base, ...interval })) : [base];
    for (const candidate of runs) {
      const reasons: string[] = [];
      const page = pages.find((source) => source.url === candidate.url);
      const host = officialHost(candidate.url);
      if (!host || !officialHosts.has(host)) reasons.push("unapproved_source");
      if (!page) {
        reasons.push("source_not_captured");
      } else if (!normalize(page.text)) {
        reasons.push("source_unavailable");
      } else {
        const source = normalize(page.text);
        if (
          [
            candidate.titleEvidence,
            candidate.venueEvidence,
            candidate.dateEvidence,
            candidate.dateText,
            original.dateEvidence,
          ].some((quote) => !normalize(quote) || !source.includes(normalize(quote)))
        ) {
          reasons.push("evidence_not_in_source");
        }
      }
      if (!normalize(candidate.title) || !normalize(candidate.titleEvidence).includes(normalize(candidate.title))) {
        reasons.push("title_not_supported");
      }
      if (!normalize(candidate.dateEvidence).includes(normalize(candidate.title))) {
        reasons.push("title_not_in_date_evidence");
      }
      if (!completeIntervals) reasons.push("incomplete_intervals");
      const venue = normalize(candidate.venueEvidence);
      if (
        ![museum.name, ...(museum.venueNames ?? [])].some((name) => normalize(name) && venue.includes(normalize(name)))
      ) {
        reasons.push("venue_not_supported");
      }
      if (!candidate.venueMatch) reasons.push("wrong_venue");
      if (candidate.kind !== "temporary_exhibition") reasons.push("not_temporary_exhibition");
      if (candidate.datePrecision !== "day") reasons.push("unsupported_precision");
      if (candidate.startDate !== null && !isCalendarDate(candidate.startDate)) reasons.push("invalid_start_date");
      if (candidate.endDate === null) {
        reasons.push("missing_end_date");
      } else if (!isCalendarDate(candidate.endDate)) {
        reasons.push("invalid_end_date");
      } else {
        if (candidate.startDate !== null && candidate.startDate > candidate.endDate) reasons.push("reversed_dates");
        if (candidate.endDate < asOfDate) reasons.push("expired");
      }
      const quotedRanges = evidenceRanges(candidate.dateEvidence, asOfYear, order);
      if (
        quotedRanges.length > 1
        && !quotedRanges.every((range) => range.closureSplit)
        && !joinedDateRanges(candidate.dateEvidence, quotedRanges)
      ) {
        reasons.push("ambiguous_date_evidence");
      }
      if (
        !quotedRanges.some((range) => range.startDate === candidate.startDate && range.endDate === candidate.endDate)
      ) {
        reasons.push("dates_not_supported");
      }
      const key = JSON.stringify([normalize(candidate.title), candidate.startDate, candidate.endDate]);
      if (reasons.length === 0 && seen.has(key)) reasons.push("duplicate");
      if (reasons.length > 0) {
        rejected.push({ candidate, reasons });
      } else {
        seen.add(key);
        accepted.push({
          ...candidate,
          endDate: candidate.endDate!,
          museumId: museum.museumId,
          timeZone: museum.timeZone,
          checkedAt: page!.checkedAt,
          sourceSha256: page!.sha256,
        });
      }
    }
  }
  return { accepted, rejected };
}
