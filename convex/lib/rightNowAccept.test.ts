import { describe, expect, it } from "vitest";

import { regionDomains } from "./regions";
import {
  acceptRightNow,
  eligibleResults,
  firstSentence,
  isAbstention,
  isListingUrl,
  sentences,
} from "./rightNowAccept";
import { FIXTURE_NOW, rightNowFixtures, type RightNowFixture } from "./rightNowFixtures";

const DAY = 24 * 60 * 60 * 1000;

function accept(fixture: RightNowFixture, now = FIXTURE_NOW) {
  return acceptRightNow(fixture.response, {
    artist: fixture.artist,
    domains: regionDomains(fixture.region)!,
    now,
  });
}

describe("recorded Tavily acceptance cases", () => {
  it.each(["kusamaSf", "crosbyNy", "deOthelloNy"] as const)(
    "refuses %s: shared entities do not validate a paraphrased event claim",
    (name) => {
      expect(accept(rightNowFixtures[name])).toBeNull();
    },
  );

  it("refuses the Kusama answer whose death date contradicts every eligible source", () => {
    expect(accept(rightNowFixtures.kusamaNy)).toBeNull();
  });

  it("refuses the Monet answer whose first sentence is not supported by the only eligible result", () => {
    expect(accept(rightNowFixtures.monetLondon)).toBeNull();
    expect(
      eligibleResults(rightNowFixtures.monetLondon.response.results, {
        domains: regionDomains("london")!,
        now: FIXTURE_NOW,
      }),
    ).toHaveLength(1);
  });

  it.each(["hockneyNy", "rupyTutSf"] as const)("never shows the %s abstention as news", (name) => {
    expect(isAbstention(rightNowFixtures[name].response.answer!)).toBe(true);
    expect(accept(rightNowFixtures[name])).toBeNull();
  });

  it.each(["hockneySf", "banksyNy", "emptyFilter"] as const)(
    "refuses low-score and archive-backed answers (%s)",
    (name) => {
      expect(accept(rightNowFixtures[name])).toBeNull();
    },
  );

  it("refuses a synthetic-name answer even when its results are boosted above the cutoff", () => {
    const boosted = {
      ...rightNowFixtures.emptyFilter.response,
      results: rightNowFixtures.emptyFilter.response.results.map((result) => ({
        ...result,
        score: 0.9,
      })),
    };
    expect(
      acceptRightNow(boosted, {
        artist: "Artlog Qzxvra Nullex 7c9e2",
        domains: regionDomains("sf-bay-area")!,
        now: FIXTURE_NOW,
      }),
    ).toBeNull();
  });
});

describe("publication window and page types", () => {
  const base = rightNowFixtures.kusamaSf.response.results[0];
  const domains = regionDomains("sf-bay-area")!;

  it.each([
    ["missing", undefined],
    ["malformed", "yesterday-ish"],
    ["future", new Date(FIXTURE_NOW + DAY).toUTCString()],
    ["older than 31 days", new Date(FIXTURE_NOW - 32 * DAY).toUTCString()],
  ])("refuses a %s publication date", (_label, publishedDate) => {
    expect(
      eligibleResults([{ ...base, publishedDate }], {
        domains,
        now: FIXTURE_NOW,
      }),
    ).toEqual([]);
  });

  it("keeps a date exactly inside the window and refuses a score below 0.60", () => {
    const inside = {
      ...base,
      publishedDate: new Date(FIXTURE_NOW - 30 * DAY).toUTCString(),
    };
    expect(eligibleResults([inside], { domains, now: FIXTURE_NOW })).toHaveLength(1);
    expect(
      eligibleResults([{ ...inside, score: 0.59 }], {
        domains,
        now: FIXTURE_NOW,
      }),
    ).toEqual([]);
  });

  it("refuses hosts outside the region list and non-https pages", () => {
    expect(
      eligibleResults([{ ...base, url: "https://www.latimes.com/arts/kusama" }], {
        domains,
        now: FIXTURE_NOW,
      }),
    ).toEqual([]);
    expect(
      eligibleResults([{ ...base, url: base.url.replace("https://", "http://") }], {
        domains,
        now: FIXTURE_NOW,
      }),
    ).toEqual([]);
  });

  it("treats a recently dated archive or category page as no evidence of a current event", () => {
    const archive = rightNowFixtures.hockneySf.response.results[0];
    expect(isListingUrl(archive.url)).toBe(true);
    expect(
      eligibleResults([{ ...archive, score: 0.9 }], {
        domains,
        now: FIXTURE_NOW,
      }),
    ).toEqual([]);
    for (const url of [
      "https://www.kqed.org/arts/tag/featured?page=190",
      "https://www.nytimes.com/section/arts/design?page=4",
      "https://www.nytimes.com/topic/ewan-mcgregor",
      "https://shop.artic.edu/products/60442",
      "https://www.nytimes.com/spotlight/what-to-watch",
    ]) {
      expect(isListingUrl(url)).toBe(true);
    }
    expect(isListingUrl(base.url)).toBe(false);
  });
});

describe("complete source sentences and event dates", () => {
  const date = "September 12, 2026";
  const sentence = `Mira Vale opens “Harbor at Dawn” at the Bay Museum on ${date} with 40 works.`;
  const options = {
    artist: "Mira Vale",
    domains: ["museum.example"],
    now: FIXTURE_NOW,
  };
  const result = {
    url: "https://museum.example/news/harbor-at-dawn",
    title: "Exhibition announcement",
    score: 0.9,
    publishedDate: "2026-09-07",
    content: sentence,
    images: [],
  };
  const card = (answer: string, content = sentence) =>
    acceptRightNow(
      {
        answer,
        images: [],
        results: [
          {
            ...result,
            content: `${content} Visitor information is available on the museum website.`,
          },
        ],
      },
      options,
    );

  it.each(["September 12, 2026", "12 September 2026", "Sep. 12, 2026", "2026-09-12"])(
    "accepts a complete sentence with an explicit current event date (%s)",
    (eventDate) => {
      const text = sentence.replace(date, eventDate);
      expect(card(text, text)).toMatchObject({ text, sourceUrl: result.url });
    },
  );

  it("cites the source containing the full sentence even when a weaker match ranks higher", () => {
    expect(
      acceptRightNow(
        {
          answer: sentence,
          images: [],
          results: [
            {
              ...result,
              url: "https://museum.example/news/cancelled",
              score: 0.95,
              content: sentence.replace("opens", "will not open"),
            },
            result,
          ],
        },
        options,
      ),
    ).toMatchObject({ text: sentence, sourceUrl: result.url });
  });

  it("allows typography and whitespace differences without discarding words or punctuation", () => {
    expect(card(sentence, sentence.replaceAll(/[“”]/g, '"').replace("opens", "opens   "))).not.toBeNull();
  });

  it.each([
    ["a changed date", sentence.replace(date, "September 13, 2026")],
    ["a changed number", sentence.replace("40", "41")],
    ["a missing negation", sentence.replace("opens", "will not open")],
    ["a claim reported as false", `The rumour that ${sentence} is false.`],
    ["a dropped qualification", sentence.replace(/\.$/, ", but this opening has since been cancelled.")],
    ["an omitted part of the snippet", sentence.replace(" at the Bay Museum ", " [...] at the Bay Museum ")],
  ])("refuses %s even when the artist, venue and title match", (_name, content) => {
    expect(card(sentence, content)).toBeNull();
  });

  it.each(["September 12, 2016", "September 12", "2026", "February 30, 2026", "November 12, 2026"])(
    "does not use publication metadata to supply a missing or invalid event date (%s)",
    (eventDate) => {
      const text = sentence.replace(date, eventDate);
      expect(card(text, text)).toBeNull();
    },
  );

  it("keeps negative event news negative when it is copied in full", () => {
    const text = sentence.replace("opens", "will not open");
    expect(card(text, text)).toMatchObject({ text });
  });

  it.each([
    `${sentence} Update: This opening has since been cancelled, and the exhibition will not take place.`,
    `${sentence}\nThe museum has postponed this opening indefinitely.`,
    `The following announcement has been retracted. ${sentence}`,
    `${sentence} [...] The opening date is provisional and subject to change.`,
    `${sentence} However, the museum now denies that this event is scheduled.`,
    `${sentence}\nVisitor information is available online.\nThe exhibition will no longer take place.`,
  ])("refuses a source that qualifies or retracts the matching sentence: %s", (content) => {
    expect(card(sentence, content)).toBeNull();
  });

  it("refuses a qualification in the answer even when the source matches its opening sentence", () => {
    expect(card(`${sentence} However, the museum has cancelled the opening.`)).toBeNull();
  });

  it("does not treat related-story boilerplate as a qualification of the article", () => {
    expect(card(sentence, `${sentence}\n## Related stories\nAnother exhibition has been cancelled.`)).not.toBeNull();
  });

  it("refuses overlong sentences instead of truncating a qualification", () => {
    const text = sentence.replace(/\.$/, ` ${"with additional displays ".repeat(8)}, but the show has been cancelled.`);
    expect(text.length).toBeGreaterThan(200);
    expect(card(text, text)).toBeNull();
  });
});

describe("first sentence", () => {
  it("preserves initials, titles and month abbreviations", () => {
    expect(firstSentence("Rupy C. Tut's new show opens at Mr. Smith's gallery on Aug. 14. It runs for a month.")).toBe(
      "Rupy C. Tut's new show opens at Mr. Smith's gallery on Aug. 14.",
    );
    expect(sentences("One sentence. Another one! A third?")).toEqual(["One sentence.", "Another one!", "A third?"]);
    expect(firstSentence("  Spaced   out\nanswer.  ")).toBe("Spaced out answer.");
  });
});

const now = Date.parse("2026-09-08T12:00:00Z");
const answer = "Mira Vale opens “Harbor at Dawn” at the Bay Museum with 40 works.";

it.each([
  [
    "a cancelled show",
    "Mira Vale will not open “Harbor at Dawn” at the Bay Museum with 40 works. The exhibition has been cancelled and no opening is planned.",
  ],
  [
    "an old exhibition",
    "Mira Vale exhibited “Harbor at Dawn” at the Bay Museum with 40 works in 2016. The show closed a decade ago; no new exhibition has been announced.",
  ],
])("rejects an opening claim contradicted by %s", (_name, content) => {
  const card = acceptRightNow(
    {
      answer,
      images: [],
      results: [
        {
          url: "https://museum.example/news/harbor-at-dawn",
          title: "Mira Vale exhibition update",
          score: 0.9,
          publishedDate: "2026-09-07",
          content,
          images: [],
        },
      ],
    },
    { artist: "Mira Vale", domains: ["museum.example"], now },
  );
  expect(card).toBeNull();
});
