import assert from "node:assert/strict";
import { test } from "node:test";

import { validateExhibitions, type ExhibitionCandidate, type ExhibitionMuseum } from "./acceptance.mts";

const museum: ExhibitionMuseum = {
  museumId: "test-museum",
  name: "Example Art Museum",
  timeZone: "America/Los_Angeles",
  sourceUrls: ["https://museum.example/exhibitions"],
};

function validate(
  changes: Partial<ExhibitionCandidate> = {},
  options: { text?: string; asOfDate?: string; museum?: ExhibitionMuseum } = {},
) {
  const candidate: ExhibitionCandidate = {
    title: "A View of the Bay",
    url: "https://museum.example/exhibitions/bay",
    startDate: "2026-09-12",
    endDate: "2027-01-03",
    dateText: "September 12, 2026 – January 3, 2027",
    titleEvidence: "A View of the Bay",
    venueEvidence: "Example Art Museum",
    dateEvidence: "September 12, 2026 – January 3, 2027",
    kind: "temporary_exhibition",
    venueMatch: true,
    datePrecision: "day",
    ...changes,
  };
  candidate.dateEvidence = `${candidate.titleEvidence}\n${candidate.dateEvidence}`;
  if (candidate.intervals) {
    candidate.intervals = candidate.intervals.map((interval) => ({
      ...interval,
      dateEvidence: `${candidate.titleEvidence}\n${interval.dateEvidence}`,
    }));
  }
  return validateExhibitions({
    museum: options.museum ?? museum,
    pages: [
      {
        url: candidate.url,
        checkedAt: 1791579600000,
        text:
          options.text
          ?? `Example Art Museum\nA View of the Bay\n${candidate.dateText}\n${candidate.dateEvidence}\n${candidate.intervals?.map((interval) => interval.dateEvidence).join("\n") ?? ""}`,
        sha256: "a".repeat(64),
      },
    ],
    candidates: [candidate],
    asOfDate: options.asOfDate ?? "2026-10-09",
  });
}

await test("accepts exact official dates and preserves capture provenance", () => {
  const result = validate();
  assert.equal(result.accepted.length, 1);
  assert.equal(result.rejected.length, 0);
  assert.equal(result.accepted[0]?.museumId, museum.museumId);
  assert.equal(result.accepted[0]?.timeZone, museum.timeZone);
  assert.equal(result.accepted[0]?.checkedAt, 1791579600000);
  assert.equal(result.accepted[0]?.sourceSha256, "a".repeat(64));
});

await test("accepts upcoming exhibitions", () => {
  assert.equal(validate({}, { asOfDate: "2026-08-01" }).accepted.length, 1);
});

await test("compares expiration using the provided museum calendar date, inclusively", () => {
  assert.equal(validate({}, { asOfDate: "2027-01-03" }).accepted.length, 1);
  assert.ok(validate({}, { asOfDate: "2027-01-04" }).rejected[0]?.reasons.includes("expired"));
});

await test("rejects a month-only range even if the extractor claims day precision", () => {
  const result = validate({
    startDate: "2026-09-01",
    endDate: "2027-01-31",
    dateText: "September 2026 – January 2027",
    dateEvidence: "September 2026 – January 2027",
  });
  assert.ok(result.rejected[0]?.reasons.includes("dates_not_supported"));
});

await test("rejects non-day precision and an unknown end", () => {
  assert.ok(validate({ datePrecision: "month" }).rejected[0]?.reasons.includes("unsupported_precision"));
  assert.ok(validate({ endDate: null }).rejected[0]?.reasons.includes("missing_end_date"));
});

await test("ties an omitted year to the explicit year in the same range", () => {
  assert.equal(
    validate({
      startDate: "2026-09-12",
      endDate: "2026-11-03",
      dateText: "September 12 – November 3, 2026",
      dateEvidence: "September 12 – November 3, 2026",
    }).accepted.length,
    1,
  );
});

await test("ties a same-month abbreviated run to its explicit year", () => {
  assert.equal(
    validate({
      startDate: "2026-10-12",
      endDate: "2026-10-30",
      dateText: "Oct. 12–30, 2026",
      dateEvidence: "Oct. 12–30, 2026",
    }).accepted.length,
    1,
  );
});

await test("infers the previous year only from a joined range crossing new year", () => {
  assert.equal(
    validate({
      dateText: "September 12 – January 3, 2027",
      dateEvidence: "September 12 – January 3, 2027",
    }).accepted.length,
    1,
  );
});

await test("rejects dates with no explicit year", () => {
  assert.ok(
    validate({
      dateText: "September 12 – January 3",
      dateEvidence: "September 12 – January 3",
    }).rejected[0]?.reasons.includes("dates_not_supported"),
  );
});

await test("does not infer a year by partially matching an explicitly malformed end date", () => {
  for (const dateText of [
    "October 1, 2026 – November 3, 27",
    "October 1, 2026 – November 3, 20260",
    "October 1, 2026 – November 3/30/2026",
  ]) {
    assert.ok(
      validate({
        startDate: "2026-10-01",
        endDate: "2026-11-03",
        dateText,
        dateEvidence: dateText,
      }).rejected[0]?.reasons.includes("dates_not_supported"),
      dateText,
    );
  }
});

await test("accepts English day-first and four-digit numeric ranges", () => {
  for (const dateText of [
    "12 September 2026 to 3 January 2027",
    "09/12/2026 - 01/03/2027",
    "2026-09-12 through 2027-01-03",
  ]) {
    assert.equal(validate({ dateText, dateEvidence: dateText }).accepted.length, 1, dateText);
  }
});

await test("accepts an explicitly stated closing date without inventing the opening date", () => {
  assert.equal(
    validate({
      startDate: null,
      dateText: "On view through January 3, 2027",
      dateEvidence: "On view through January 3, 2027",
    }).accepted.length,
    1,
  );
});

await test("accepts SVMA's explicit US numeric dot dates without inventing day precision", () => {
  for (const dateText of ["02.06.27 - 06.13.27", "02/06/27 - 06/13/27", "02.06.2027 - 06.13.2027"]) {
    assert.equal(
      validate({
        startDate: "2027-02-06",
        endDate: "2027-06-13",
        dateText,
        dateEvidence: dateText,
      }).accepted.length,
      1,
      dateText,
    );
  }
});

await test("accepts OMCA and SJMA date ranges whose endpoints include weekday labels", () => {
  for (const dateText of [
    "Friday, September 18, 2026—Sunday, December 27, 2026",
    "Fri., September 18, 2026 – Sun., December 27, 2026",
    "Friday, 18 September 2026 to Sunday, 27 December 2026",
    "Fri, 09/18/2026 - Sun, 12/27/2026",
  ]) {
    assert.equal(
      validate({
        startDate: "2026-09-18",
        endDate: "2026-12-27",
        dateText,
        dateEvidence: dateText,
      }).accepted.length,
      1,
      dateText,
    );
  }
});

await test("normalizes an HTML-split four-digit year in both captured quote binding and dates", () => {
  const dateText = "September 18, 2026 – January 3, 202\n7";
  assert.equal(
    validate({
      startDate: "2026-09-18",
      endDate: "2027-01-03",
      dateText,
      dateEvidence: dateText,
    }).accepted.length,
    1,
  );
  assert.equal(
    validate(
      {
        startDate: "2026-09-18",
        endDate: "2027-01-03",
        dateText: "September 18, 2026 – January 3, 2027",
        dateEvidence: "September 18, 2026 – January 3, 2027",
      },
      { text: `Example Art Museum\nA View of the Bay\n${dateText}` },
    ).accepted.length,
    1,
  );
});

await test("subtracts de Saisset's explicit academic closure rather than bridging its gap", () => {
  const dateText = "September 22–December 11, 2026 (Closed November 21–30 for academic break)";
  for (const [startDate, endDate] of [
    ["2026-09-22", "2026-11-20"],
    ["2026-12-01", "2026-12-11"],
  ]) {
    assert.equal(
      validate({ startDate: startDate!, endDate: endDate!, dateText, dateEvidence: dateText }).accepted.length,
      1,
    );
  }
  assert.ok(
    validate({
      startDate: "2026-09-22",
      endDate: "2026-12-11",
      dateText,
      dateEvidence: dateText,
    }).rejected[0]?.reasons.includes("dates_not_supported"),
  );
  assert.ok(
    validate({
      startDate: "2026-11-21",
      endDate: "2026-11-30",
      dateText,
      dateEvidence: dateText,
    }).rejected[0]?.reasons.includes("dates_not_supported"),
  );
});

await test("rejects ambiguous, invalid and out-of-bounds closure dates", () => {
  for (const dateText of [
    "September 22, 2026–December 11, 2027 (Closed November 21–30 for academic break)",
    "September 22–December 11, 2026 (Closed November 21–31 for academic break)",
    "September 22–December 11, 2026 (Closed December 12–20 for academic break)",
    "September 22–December 11, 2026 (Closed November 21–30) (Closed December 2–3)",
  ]) {
    assert.ok(
      validate({
        startDate: "2026-09-22",
        endDate: "2026-11-20",
        dateText,
        dateEvidence: dateText,
      }).rejected[0]?.reasons.includes("dates_not_supported"),
      dateText,
    );
  }
});

await test("allows an explicit-year closure in a published range crossing new year", () => {
  const dateText = "September 22, 2026–March 11, 2027 (Closed November 21–30, 2026)";
  assert.equal(
    validate({ startDate: "2026-12-01", endDate: "2027-03-11", dateText, dateEvidence: dateText }).accepted.length,
    1,
  );
});

await test("resolves numeric short years near the museum-local as-of year and rejects century ties", () => {
  const archived = validate({
    startDate: "1999-02-06",
    endDate: "1999-06-13",
    dateText: "02.06.99 - 06.13.99",
    dateEvidence: "02.06.99 - 06.13.99",
  });
  assert.ok(archived.rejected[0]?.reasons.includes("expired"));
  assert.ok(!archived.rejected[0]?.reasons.includes("dates_not_supported"));
  assert.ok(
    validate({
      startDate: "2099-02-06",
      endDate: "2099-06-13",
      dateText: "02.06.99 - 06.13.99",
      dateEvidence: "02.06.99 - 06.13.99",
    }).rejected[0]?.reasons.includes("dates_not_supported"),
  );
  assert.ok(
    validate({
      startDate: "2076-02-06",
      endDate: "2076-06-13",
      dateText: "02.06.76 - 06.13.76",
      dateEvidence: "02.06.76 - 06.13.76",
    }).rejected[0]?.reasons.includes("dates_not_supported"),
  );
});

await test("does not turn a lone opening date into a same-day exhibition", () => {
  assert.ok(
    validate({
      startDate: "2026-10-12",
      endDate: "2026-10-12",
      dateText: "Opens October 12, 2026",
      dateEvidence: "Opens October 12, 2026",
    }).rejected[0]?.reasons.includes("dates_not_supported"),
  );
});

await test("accepts leap day only in a valid calendar year", () => {
  assert.equal(
    validate(
      {
        startDate: "2028-02-29",
        endDate: "2028-03-01",
        dateText: "February 29 – March 1, 2028",
        dateEvidence: "February 29 – March 1, 2028",
      },
      { asOfDate: "2028-02-29" },
    ).accepted.length,
    1,
  );
  assert.ok(validate({ startDate: "2027-02-29" }).rejected[0]?.reasons.includes("invalid_start_date"));
  assert.ok(validate({ endDate: "2027-02-29" }).rejected[0]?.reasons.includes("invalid_end_date"));
});

await test("rejects a reversed range", () => {
  assert.ok(validate({ startDate: "2027-01-04" }).rejected[0]?.reasons.includes("reversed_dates"));
});

await test("rejects fabricated days and dates collected from unrelated sentences", () => {
  assert.ok(validate({ endDate: "2027-01-04" }).rejected[0]?.reasons.includes("dates_not_supported"));
  assert.ok(
    validate({
      dateText: "Opening: September 12, 2026. Lecture: January 3, 2027.",
      dateEvidence: "Opening: September 12, 2026. Lecture: January 3, 2027.",
    }).rejected[0]?.reasons.includes("dates_not_supported"),
  );
});

await test("requires all quotations to come from the exact captured source page", () => {
  for (const [field, quote] of [
    ["titleEvidence", "A title not in the page"],
    ["venueEvidence", "A venue not in the page"],
    ["dateEvidence", "February 1 – December 1, 2026"],
    ["dateText", "February 1 – December 1, 2026"],
  ] as const) {
    const result = validate(
      { [field]: quote },
      { text: "Example Art Museum\nA View of the Bay\nSeptember 12, 2026 – January 3, 2027" },
    );
    assert.ok(result.rejected[0]?.reasons.includes("evidence_not_in_source"), field);
  }
});

await test("normalizes typography and whitespace without fabricating quotations", () => {
  assert.equal(
    validate({}, { text: "EXAMPLE ART MUSEUM\nA View of the Bay\nSeptember 12, 2026—January 3, 2027" }).accepted.length,
    1,
  );
});

await test("requires title evidence to identify the candidate title", () => {
  assert.ok(validate({ title: "Another Show" }).rejected[0]?.reasons.includes("title_not_supported"));
});

await test("rejects a listing title paired with another exhibition's date quote", () => {
  const result = validateExhibitions({
    museum,
    pages: [
      {
        url: "https://museum.example/exhibitions",
        checkedAt: 1791579600000,
        sha256: "a".repeat(64),
        text: "Example Art Museum\nA View of the Bay\nSeptember 12, 2026 – January 3, 2027\nAnother Show\nOctober 1, 2026 – December 31, 2026",
      },
    ],
    candidates: [
      {
        ...validate().accepted[0]!,
        url: "https://museum.example/exhibitions",
        startDate: "2026-10-01",
        endDate: "2026-12-31",
        dateText: "October 1, 2026 – December 31, 2026",
        dateEvidence: "Another Show\nOctober 1, 2026 – December 31, 2026",
      },
    ],
    asOfDate: "2026-10-09",
  });
  assert.ok(result.rejected[0]?.reasons.includes("title_not_in_date_evidence"));
});

await test("rejects a quote spanning two exhibition cards despite containing the requested title", () => {
  const result = validate({
    dateText: "September 12, 2026 – January 3, 2027\nAnother Show\nOctober 1, 2026 – December 31, 2026",
    dateEvidence: "September 12, 2026 – January 3, 2027\nAnother Show\nOctober 1, 2026 – December 31, 2026",
  });
  assert.ok(result.rejected[0]?.reasons.includes("ambiguous_date_evidence"));
});

await test("does not discard a quoted opening date from an explicit through range", () => {
  const result = validate({
    startDate: null,
    dateText: "September 12, 2026 through January 3, 2027",
    dateEvidence: "September 12, 2026 through January 3, 2027",
  });
  assert.ok(result.rejected[0]?.reasons.includes("dates_not_supported"));
});

await test("requires explicit split runs to account for every quoted date interval", () => {
  const result = validate({
    dateText: "October 1–12, 2026; November 1–12, 2026",
    dateEvidence: "October 1–12, 2026; November 1–12, 2026",
    intervals: [{ startDate: "2026-10-01", endDate: "2026-10-12", dateEvidence: "October 1–12, 2026" }],
  });
  assert.ok(result.rejected[0]?.reasons.includes("incomplete_intervals"));
});

await test("rejects permanent displays, events, unknown kinds, and wrong physical venues", () => {
  for (const kind of ["permanent", "event", "unknown"] as const) {
    assert.ok(validate({ kind }).rejected[0]?.reasons.includes("not_temporary_exhibition"));
  }
  assert.ok(validate({ venueMatch: false }).rejected[0]?.reasons.includes("wrong_venue"));
  assert.ok(
    validate(
      { venueEvidence: "Other Art Museum" },
      { text: "Other Art Museum\nA View of the Bay\nSeptember 12, 2026 – January 3, 2027" },
    ).rejected[0]?.reasons.includes("venue_not_supported"),
  );
});

await test("uses curated museum name aliases for official venue evidence", () => {
  assert.equal(
    validate(
      { venueEvidence: "Example" },
      { museum: { ...museum, name: "Example Art Museum at University", venueNames: ["Example"] } },
    ).accepted.length,
    1,
  );
});

await test("requires a captured URL on a curated official source host", () => {
  const candidate = validate().accepted[0]!;
  assert.ok(
    validateExhibitions({
      museum,
      candidates: [candidate],
      pages: [],
      asOfDate: "2026-10-09",
    }).rejected[0]?.reasons.includes("source_not_captured"),
  );
  assert.ok(validate({ url: "https://impostor.example/show" }).rejected[0]?.reasons.includes("unapproved_source"));
});

await test("deduplicates a title and interval across sources while keeping distinct shows", () => {
  const first = validate().accepted[0]!;
  const result = validateExhibitions({
    museum,
    pages: [
      {
        url: first.url,
        checkedAt: first.checkedAt,
        sha256: first.sourceSha256,
        text: "Example Art Museum\nA View of the Bay\nSeptember 12, 2026 – January 3, 2027\nAnother Show\nSeptember 12, 2026 – January 3, 2027",
      },
      {
        url: "https://museum.example/exhibitions",
        checkedAt: first.checkedAt,
        sha256: "b".repeat(64),
        text: "Example Art Museum\nA View of the Bay\nSeptember 12, 2026 – January 3, 2027",
      },
    ],
    candidates: [
      first,
      { ...first, title: "a view of the bay" },
      { ...first, url: "https://museum.example/exhibitions" },
      {
        ...first,
        title: "Another Show",
        titleEvidence: "Another Show",
        dateEvidence: "Another Show\nSeptember 12, 2026 – January 3, 2027",
      },
    ],
    asOfDate: "2026-10-09",
  });
  assert.equal(result.accepted.length, 2);
  assert.equal(result.rejected.filter(({ reasons }) => reasons.includes("duplicate")).length, 2);
  assert.equal(result.accepted[0]?.url, first.url);
  assert.equal(result.accepted[0]?.sourceSha256, first.sourceSha256);
});

await test("keeps separate candidates for every run beneath a title printed only once", () => {
  const base = validate().accepted[0]!;
  for (const dates of [
    "October 1–12, 2026; November 1–12, 2026",
    "October 1–12, 2026 and November 1–12, 2026",
    "2026-10-01 – 2026-10-12; November 1–12, 2026",
  ]) {
    const dateEvidence = `${base.title}\n${dates}`;
    const candidates = [
      { ...base, startDate: "2026-10-01", endDate: "2026-10-12", dateText: dates, dateEvidence },
      { ...base, startDate: "2026-11-01", endDate: "2026-11-12", dateText: dates, dateEvidence },
    ];
    const pages = [
      { url: base.url, checkedAt: base.checkedAt, sha256: base.sourceSha256, text: `${museum.name}\n${dateEvidence}` },
    ];
    const result = validateExhibitions({ museum, candidates, pages, asOfDate: "2026-10-09" });
    assert.deepEqual(result.rejected, []);
    assert.deepEqual(
      result.accepted.map(({ startDate, endDate }) => [startDate, endDate]),
      [
        ["2026-10-01", "2026-10-12"],
        ["2026-11-01", "2026-11-12"],
      ],
    );
    const later = validateExhibitions({ museum, candidates, pages, asOfDate: "2026-10-20" });
    assert.deepEqual(
      later.accepted.map(({ startDate }) => startDate),
      ["2026-11-01"],
    );
    assert.ok(later.rejected[0]?.reasons.includes("expired"));
  }
});

await test("does not join periods separated by another show's title or descriptive text", () => {
  for (const separator of ["\nAnother Show\n", "; Another Show: ", "; a lecture runs "]) {
    const dates = `October 1–12, 2026${separator}November 1–12, 2026`;
    const result = validate({ startDate: "2026-11-01", endDate: "2026-11-12", dateText: dates, dateEvidence: dates });
    assert.ok(result.rejected[0]?.reasons.includes("ambiguous_date_evidence"));
  }
});

await test("splits disjoint runs and rejects a fabricated continuous interval across the gap", () => {
  const dateText = "October 1–12, 2026; November 1–12, 2026";
  const result = validate({
    startDate: "2026-10-01",
    endDate: "2026-11-12",
    dateText,
    dateEvidence: dateText,
    intervals: [
      { startDate: "2026-10-01", endDate: "2026-10-12", dateEvidence: "October 1–12, 2026" },
      { startDate: "2026-11-01", endDate: "2026-11-12", dateEvidence: "November 1–12, 2026" },
    ],
  });
  assert.deepEqual(
    result.accepted.map(({ startDate, endDate }) => [startDate, endDate]),
    [
      ["2026-10-01", "2026-10-12"],
      ["2026-11-01", "2026-11-12"],
    ],
  );
  assert.ok(
    validate({
      startDate: "2026-10-01",
      endDate: "2026-11-12",
      dateText,
      dateEvidence: dateText,
    }).rejected[0]?.reasons.includes("dates_not_supported"),
  );
});

await test("checks each split run independently, including expired runs", () => {
  const result = validate({
    dateText: "September 1–12, 2026; November 1–12, 2026",
    dateEvidence: "September 1–12, 2026; November 1–12, 2026",
    intervals: [
      { startDate: "2026-09-01", endDate: "2026-09-12", dateEvidence: "September 1–12, 2026" },
      { startDate: "2026-11-01", endDate: "2026-11-12", dateEvidence: "November 1–12, 2026" },
    ],
  });
  assert.equal(result.accepted.length, 1);
  assert.equal(result.accepted[0]?.startDate, "2026-11-01");
  assert.ok(result.rejected[0]?.reasons.includes("expired"));
});

await test("requires a valid as-of calendar date", () => {
  assert.throws(() => validate({}, { asOfDate: "2026-02-30" }), /asOfDate/);
});
