import { describe, expect, it } from "vitest";

import { graphPage, jsonLdPage, metaPage, plainPage } from "./labelFixtures";
import { decodeEntities, extractPage, hasArtworkMetadata } from "./pageExtract";

describe("page extraction", () => {
  it("reads a schema.org VisualArtwork node before any meta fallback", () => {
    const page = extractPage(jsonLdPage);
    expect(page.source).toBe("jsonld");
    expect(page.fields).toEqual({
      title: "Water Lilies",
      artist: "Claude Monet",
      date: "1919",
      medium: "Oil on canvas",
      accession: "1998.325.2",
      creditLine: "Gift of Louise Reinhardt Smith, 1983",
    });
    expect(page.imageUrls).toEqual([
      "https://collectionapi.metmuseum.org/api/collection/v1/iiif/437137/2018391/main-image",
    ]);
  });

  it("walks an @graph with array types, nested creators and PropertyValue identifiers", () => {
    const page = extractPage(graphPage);
    expect(page.fields).toEqual({
      title: "The Thinker",
      artist: "Auguste Rodin",
      date: "1880–81, cast 1916",
      medium: "bronze",
      accession: "1917.42",
    });
    expect(page.imageUrls).toEqual(["https://openaccess-cdn.clevelandart.org/1917.42/1917.42_web.jpg"]);
  });

  it("falls back to og:title, meta author, a cued accession and og:image", () => {
    const page = extractPage(metaPage);
    expect(page.source).toBe("meta");
    expect(page.fields).toEqual({
      title: "Nighthawks",
      artist: "Edward Hopper",
      accession: "1942.51",
    });
    expect(page.imageUrls).toEqual([
      "https://www.artic.edu/iiif/2/831a05de-d3f6-f4fa-a460-23008dd58dda/full/843,/0/default.jpg",
    ]);
  });

  it("does not read dimensions or script literals as an accession without a cue", () => {
    const page = extractPage(
      '<html><body><p>Oil on canvas, 130.2 x 200.7 cm</p><script>v="2012.5"</script></body></html>',
    );
    expect(page.fields.accession).toBeUndefined();
    expect(
      extractPage("<html><body>Bequest, 1998. Object 1998.325.2 hangs in Gallery 819.</body></html>").fields.accession,
    ).toBe("1998.325.2");
    expect(extractPage("<html><body>Bequest of Sam Salz, 1998.325.2</body></html>").fields.accession).toBe(
      "1998.325.2",
    );
  });

  it("reports pages without artwork data and keeps the whole title when it has no site suffix", () => {
    const page = extractPage(plainPage);
    expect(page.source).toBe("meta");
    expect(page.fields).toEqual({ title: "Visit us" });
    expect(extractPage("<html></html>")).toEqual({
      fields: {},
      imageUrls: [],
      source: "none",
    });
  });

  it("decodes named, decimal and hex entities and leaves unknown ones alone", () => {
    expect(decodeEntities("Caf&eacute; &amp; &#8220;Bar&#x201D; &ndash; &bogus;")).toBe(
      "Caf&eacute; & “Bar” – &bogus;",
    );
  });

  it("distinguishes artwork metadata from page titles and article authors", () => {
    expect(hasArtworkMetadata(extractPage(jsonLdPage))).toBe(true);
    expect(hasArtworkMetadata(extractPage(metaPage))).toBe(true);
    expect(hasArtworkMetadata(extractPage(plainPage))).toBe(false);
    expect(hasArtworkMetadata(extractPage('<title>Visit us</title><meta name="author" content="Museum staff">'))).toBe(
      false,
    );
    expect(
      hasArtworkMetadata(extractPage('<script type="application/ld+json">{"@type":"VisualArtwork"}</script>')),
    ).toBe(false);
    expect(
      hasArtworkMetadata(
        extractPage('<title>Visit us</title><script type="application/ld+json">{"@type":"VisualArtwork"}</script>'),
      ),
    ).toBe(false);
  });

  it("prefers artwork-node images over unrelated page-level sharing images", () => {
    const html = graphPage.replace(
      "<head>",
      '<head><meta property="og:image" content="https://www.clevelandart.org/unrelated.jpg">',
    );
    expect(extractPage(html).imageUrls).toEqual(["https://openaccess-cdn.clevelandart.org/1917.42/1917.42_web.jpg"]);
  });
});
