import { expect, it } from "vitest";

import { commonsReferences, boundedReferences, wikidataReferences } from "./artworkReferences";

it("reads only the artwork's source and reference cells, including encoded IDs", () => {
  const html = `<a href="https://unrelated.org">Home</a><table><tr><td id="fileinfotpl&#95;art&#95;references">References</td><td><a href="https://auction.example/lot/1">Lot</a></td></tr><tr><td id="fileinfotpl_src">Source</td><td><a href="https://gallery.example/work/1">Source</a></td></tr><tr><td>Artist</td><td><a href="https://artist.example">Biography</a></td></tr></table>`;
  expect(commonsReferences(html, "https://commons.wikimedia.org/wiki/File:A.jpg").map((r) => r.url)).toEqual([
    "https://auction.example/lot/1",
    "https://gallery.example/work/1",
  ]);
});

it("skips the Wikidata property pages that Commons links beside each identifier", () => {
  const html = `<table><tr><td id="fileinfotpl_src">Source</td><td><a href="https://www.artic.edu/artworks/111670">Art Institute</a> <a href="https://www.wikidata.org/wiki/Property:P4610">Art Institute of Chicago artwork ID</a> <a href="https://www.wikidata.org/wiki/Q20268582">Q20268582</a> <a href="https://commons.wikimedia.org/wiki/Category:Paintings">Category</a></td></tr></table>`;
  expect(commonsReferences(html, "https://commons.wikimedia.org/wiki/File:A.jpg").map((r) => r.url)).toEqual([
    "https://www.artic.edu/artworks/111670",
    "https://www.wikidata.org/wiki/Q20268582",
  ]);
});

it("follows statement reference URLs, not arbitrary URL-valued claims", () => {
  expect(
    wikidataReferences({
      id: "Q1",
      claims: {
        P170: [{ references: [{ snaks: { P854: [{ datavalue: { value: "https://catalogue.example/1" } }] } }] }],
        P856: [{ mainsnak: { datavalue: { value: "https://unrelated.org" } } }],
      },
    }),
  ).toEqual([{ url: "https://catalogue.example/1", referenceUrl: "https://www.wikidata.org/wiki/Q1" }]);
});

it("deduplicates references and caps public HTTPS targets at five without a publisher list", () => {
  const urls = [
    "http://museum.org/a",
    "https://127.0.0.1/a",
    "https://a.internal/a",
    "https://user:password@a.org/a",
    "https://a.org:444/a",
    "https://a.org/a#one",
    "https://www.a.org/a?utm_source=x",
    ...Array.from({ length: 9 }, (_, i) => `https://new-publisher.org/${i}`),
  ];
  const result = boundedReferences(urls.map((url) => ({ url, referenceUrl: "https://www.wikidata.org/wiki/Q1" })));
  expect(result.map((r) => r.url)).toEqual([
    "https://a.org/a",
    ...Array.from({ length: 4 }, (_, i) => `https://new-publisher.org/${i}`),
  ]);
});
