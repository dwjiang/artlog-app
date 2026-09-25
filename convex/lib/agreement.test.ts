import { expect, it } from "vitest";

import { verifiedAccession, workKey } from "./agreement";
import type { ContributionField } from "./validators";

const field = (value: string, evidence: ContributionField["evidence"], edited = false): ContributionField => ({
  value,
  evidence,
  edited,
});
const fields = {
  title: field("Water Lilies", "ocr"),
  artist: field("Claude Monet", "ocr"),
};

it("normalizes names for grouping without asserting identity truth", () => {
  expect(workKey(fields)).toBe(
    workKey({
      title: field(" WATER LILIES ", "qr"),
      artist: field("Claude MONET", "qr"),
    }),
  );
});

it.each(["ocr", "user_edited", "wikidata", "tavily"] as const)(
  "does not treat a %s accession as verified",
  (evidence) => {
    expect(
      verifiedAccession({
        fields: { ...fields, accession: field("123", evidence) },
      }),
    ).toBeUndefined();
  },
);

it.each(["qr", "accession", "tavily+image"] as const)(
  "compares verified %s accessions but ignores an edited claim",
  (evidence) => {
    expect(
      verifiedAccession({
        fields: { ...fields, accession: field(" 123 ", evidence) },
      }),
    ).toBe("123");
    expect(
      verifiedAccession({
        fields: { ...fields, accession: field("123", evidence, true) },
      }),
    ).toBeUndefined();
  },
);
